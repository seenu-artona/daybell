import { afterEach, describe, expect, it, vi } from "vitest";

// GET /clients?q= (D96 studio separation, CLAUDE.md rule 4): the list is scoped to the caller's studio (studio_id from
// studioScope), and ?q= narrows it by name only (ilike on "name", nothing else). Studio B searching for a name only
// studio A has gets nothing. The scope and the database are faked: the fake table answers with the rows that pass the
// filters the route applied, so a missing studio filter would leak studio A's client here. People › Clients (D150,
// ADR 0028): the count and the main contact, job count and latest job come for the caller's studio and page only.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const client = (id: string, studioId: string, name: string, notes: string | null = null) => ({
  id,
  studio_id: studioId,
  name,
  address_line1: null,
  address_line2: null,
  postal_code: null,
  city: "Ottawa",
  region_code: "ON",
  country: "CA",
  contact_first_name: null,
  contact_last_name: null,
  contact_phone: null,
  contact_email: null,
  notes,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
});

const TABLE = [
  client("c0000000-0000-4000-8000-00000000000a", A, "Zebulon Academy"),
  client("c0000000-0000-4000-8000-00000000000b", B, "Lincoln Elementary", "Zebulon is our contact"),
];

/** An ilike pattern ("%text%") as a case-insensitive test; the searches here hold no wildcards to escape. */
function like(pattern: string): RegExp {
  const body = pattern
    .split("%")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`, "i");
}

/** client_list_details' answer per client, as the database would give it to each studio. */
const DETAILS: Record<string, { studio: string; row: Record<string, unknown> }> = {
  "c0000000-0000-4000-8000-00000000000a": {
    studio: A,
    row: {
      client_id: "c0000000-0000-4000-8000-00000000000a",
      job_count: 3,
      latest_job: {
        id: "a0000000-0000-4000-8000-000000000001",
        name: "Fall 2026",
        picture_day: "2026-10-01",
      },
      main_contact: {
        id: "e0000000-0000-4000-8000-000000000001",
        first_name: "Dana",
        last_name: "Ruiz",
        role: "Office",
        email: "office@zebulon.example",
      },
    },
  },
  "c0000000-0000-4000-8000-00000000000b": {
    studio: B,
    row: {
      client_id: "c0000000-0000-4000-8000-00000000000b",
      job_count: 0,
      latest_job: null,
      main_contact: null,
    },
  },
};

/** A chainable fake of the Supabase query builder over TABLE, recording every filter the route applies. */
function fakeDatabase() {
  const calls: unknown[][] = [];
  const rpc = (name: string, args: { p_studio_id: string; p_client_ids: string[] }) => {
    calls.push(["rpc", name, args]);
    const data = args.p_client_ids
      .map((id) => DETAILS[id])
      .filter((d) => d?.studio === args.p_studio_id)
      .map((d) => d?.row);
    return Promise.resolve({ data, error: null });
  };
  const from = (table: string) => {
    calls.push(["from", table]);
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const rows = () => TABLE.filter((row) => filters.every((f) => f(row)));
    let head = false;
    const builder = {
      select: (columns: string, options?: { count?: string; head?: boolean }) => {
        calls.push(["select", columns, ...(options ? [options] : [])]);
        head = options?.head === true;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        calls.push(["eq", column, value]);
        filters.push((row) => row[column] === value);
        return builder;
      },
      ilike: (column: string, pattern: string) => {
        calls.push(["ilike", column, pattern]);
        filters.push((row) => like(pattern).test(String(row[column] ?? "")));
        return builder;
      },
      or: (...args: unknown[]) => {
        calls.push(["or", ...args]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      // biome-ignore lint/suspicious/noThenProperty: the Supabase builder is awaited like a promise.
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(
          head
            ? { data: null, count: rows().length, error: null }
            : { data: rows(), count: null, error: null },
        ).then(resolve, reject),
    };
    return builder;
  };
  return { supabase: { from, rpc }, calls };
}

async function list(studioId: string, query: string, region = "ca") {
  const db = fakeDatabase();
  scope.mockResolvedValue({
    supabase: db.supabase,
    studio: { id: studioId, name: "S", slug: "s", region, role: "staff" },
    userId: "u",
  });
  const { GET } = await import("./route");
  const res = await GET(new Request(`http://localhost/api/v1/clients${query}`));
  return { res, body: await res.json(), calls: db.calls };
}

describe("GET /clients?q= (leak test)", () => {
  it("scopes the list to the caller's studio, from studioScope", async () => {
    const { res, body, calls } = await list(A, "");
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["eq", "studio_id", A]);
    expect(body.clients.map((c: { name: string }) => c.name)).toEqual(["Zebulon Academy"]);
  });

  it("applies ?q= as an ilike on the name only", async () => {
    const { body, calls } = await list(A, "?q=zebu");
    // The list and its count: both by name only.
    expect(calls.filter((c) => c[0] === "ilike")).toEqual([
      ["ilike", "name", "%zebu%"],
      ["ilike", "name", "%zebu%"],
    ]);
    expect(calls.filter((c) => c[0] === "or")).toEqual([]);
    expect(body.clients.map((c: { name: string }) => c.name)).toEqual(["Zebulon Academy"]);
  });

  it("gives studio B nothing when it searches a name only studio A has (not even B's notes match)", async () => {
    const { res, body, calls } = await list(B, "?q=Zebulon");
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["eq", "studio_id", B]);
    expect(calls).not.toContainEqual(["eq", "studio_id", A]);
    expect(body).toEqual({ clients: [], nextCursor: null, total: 0 });
    // No page, no details asked for.
    expect(calls.filter((c) => c[0] === "rpc")).toEqual([]);
  });
});

describe("GET /clients: People › Clients' columns (D150)", () => {
  it("adds the main contact, job count, latest job and the total, for the caller's studio and page", async () => {
    const { body, calls } = await list(A, "");
    expect(body.total).toBe(1);
    expect(body.clients).toEqual([
      expect.objectContaining({
        name: "Zebulon Academy",
        mainContact: {
          id: "e0000000-0000-4000-8000-000000000001",
          firstName: "Dana",
          lastName: "Ruiz",
          role: "Office",
          email: "office@zebulon.example",
        },
        jobCount: 3,
        latestJob: {
          id: "a0000000-0000-4000-8000-000000000001",
          name: "Fall 2026",
          pictureDay: "2026-10-01",
        },
      }),
    ]);
    expect(calls).toContainEqual([
      "rpc",
      "client_list_details",
      { p_studio_id: A, p_client_ids: ["c0000000-0000-4000-8000-00000000000a"] },
    ]);
    // The count is the studio's too.
    const counts = calls.filter((c) => c[0] === "select" && c[2]);
    expect(counts).toEqual([["select", "id", { count: "exact", head: true }]]);
  });

  it("gives studio B its own client with no contact and no jobs, never studio A's details", async () => {
    const { body, calls } = await list(B, "");
    expect(body.clients).toEqual([
      expect.objectContaining({
        name: "Lincoln Elementary",
        mainContact: null,
        jobCount: 0,
        latestJob: null,
      }),
    ]);
    expect(calls).toContainEqual([
      "rpc",
      "client_list_details",
      { p_studio_id: B, p_client_ids: ["c0000000-0000-4000-8000-00000000000b"] },
    ]);
    expect(JSON.stringify(body)).not.toContain("Dana");
  });
});

describe("GET /clients: a page after a client that is gone", () => {
  it("has no clients and no next page, but still counts the studio's clients", async () => {
    const { res, body, calls } = await list(A, "?cursor=c0000000-0000-4000-8000-0000000000ff");
    expect(res.status).toBe(200);
    expect(body).toEqual({ clients: [], nextCursor: null, total: 1 });
    // The count is the caller's studio's.
    expect(calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
    expect(calls.filter((c) => c[0] === "eq" && c[1] === "studio_id" && c[2] !== A)).toEqual([]);
  });
});

describe("clients in Montréal (D113; ADR 0028, call 8)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pins /clients to Montréal and refuses a Canadian studio's clients elsewhere, before any query", async () => {
    expect((await import("./route")).preferredRegion).toBe("yul1");
    vi.stubEnv("VERCEL_REGION", "iad1");
    const { res, calls } = await list(A, "");
    expect(res.status).toBe(422);
    expect(calls).toEqual([]);
    const { POST } = await import("./route");
    const added = await POST(
      new Request("http://localhost/api/v1/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New School", country: "CA" }),
      }),
    );
    expect(added.status).toBe(422);
  });

  it("runs in Montréal", async () => {
    vi.stubEnv("VERCEL_REGION", "yul1");
    const { res } = await list(A, "");
    expect(res.status).toBe(200);
  });
});
