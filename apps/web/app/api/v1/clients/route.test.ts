import { describe, expect, it, vi } from "vitest";

// GET /clients?q= (D96 studio separation, CLAUDE.md rule 4): the list is scoped to the caller's studio (studio_id from
// studioScope), and ?q= narrows it by name only (ilike on "name", nothing else). Studio B searching for a name only
// studio A has gets nothing. The scope and the database are faked: the fake table answers with the rows that pass the
// filters the route applied, so a missing studio filter would leak studio A's client here.
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

/** A chainable fake of the Supabase query builder over TABLE, recording every filter the route applies. */
function fakeDatabase() {
  const calls: unknown[][] = [];
  const from = (table: string) => {
    calls.push(["from", table]);
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const rows = () => TABLE.filter((row) => filters.every((f) => f(row)));
    const builder = {
      select: (columns: string) => {
        calls.push(["select", columns]);
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
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return builder;
  };
  return { supabase: { from }, calls };
}

async function list(studioId: string, query: string) {
  const db = fakeDatabase();
  scope.mockResolvedValue({
    supabase: db.supabase,
    studio: { id: studioId, name: "S", slug: "s", region: "ca", role: "staff" },
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
    expect(calls.filter((c) => c[0] === "ilike")).toEqual([["ilike", "name", "%zebu%"]]);
    expect(calls.filter((c) => c[0] === "or")).toEqual([]);
    expect(body.clients.map((c: { name: string }) => c.name)).toEqual(["Zebulon Academy"]);
  });

  it("gives studio B nothing when it searches a name only studio A has (not even B's notes match)", async () => {
    const { res, body, calls } = await list(B, "?q=Zebulon");
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["eq", "studio_id", B]);
    expect(calls).not.toContainEqual(["eq", "studio_id", A]);
    expect(body).toEqual({ clients: [], nextCursor: null });
  });
});
