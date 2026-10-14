import { describe, expect, it, vi } from "vitest";

// People › Contacts (D150, ADR 0028; D96 leak test): every list, search, add and change is scoped to the caller's
// studio (studio_id from studioScope, never from the request); another studio's client or contact is simply not found;
// search text travels in a POST body to the database only, never in a URL (D113); owners and admins write, everyone
// else reads. The scope and the database are faked: each table and the list function answer with the rows that pass
// the filters the route applied, so a missing studio filter would leak studio A's contacts here.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT_A = "c0000000-0000-4000-8000-00000000000a";
const CLIENT_B = "c0000000-0000-4000-8000-00000000000b";
const DANA = "e0000000-0000-4000-8000-00000000000a";
const PRIYA = "e0000000-0000-4000-8000-00000000000b";

type Row = Record<string, unknown>;
const contact = (
  id: string,
  studioId: string,
  clientId: string,
  first: string,
  clientName: string,
) => ({
  id,
  studio_id: studioId,
  client_id: clientId,
  first_name: first,
  last_name: "Example",
  role: "Office",
  email: `${first.toLowerCase()}@school.example`,
  phone: null,
  is_main: true,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  client: { name: clientName },
});

function tables(): Record<string, Row[]> {
  return {
    clients: [
      { id: CLIENT_A, studio_id: A, name: "Lincoln SD" },
      { id: CLIENT_B, studio_id: B, name: "Hillcrest SD" },
    ],
    client_contacts: [
      contact(DANA, A, CLIENT_A, "Dana", "Lincoln SD"),
      contact(PRIYA, B, CLIENT_B, "Priya", "Hillcrest SD"),
    ],
  };
}

/** A chainable fake of the Supabase client over `data`, recording every call the route makes. */
function fakeDatabase() {
  const data = tables();
  const calls: unknown[][] = [];
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push(["rpc", name, args]);
    const q = typeof args.p_q === "string" ? args.p_q.toLowerCase() : null;
    const rows = (data.client_contacts ?? [])
      .filter((r) => r.studio_id === args.p_studio_id)
      .filter((r) => !args.p_client_id || r.client_id === args.p_client_id)
      .filter((r) => !args.p_main_only || r.is_main)
      .filter((r) => !q || `${r.first_name} ${r.last_name} ${r.email}`.toLowerCase().includes(q))
      .map(({ client, ...r }) => ({ ...r, client_name: (client as { name: string }).name }));
    return Promise.resolve({ data: { contacts: rows, total: rows.length }, error: null });
  };
  const from = (table: string) => {
    calls.push(["from", table]);
    const filters: ((row: Row) => boolean)[] = [];
    let write: { kind: "insert" | "update"; values: Row } | null = null;
    const matching = () => (data[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const run = () => {
      if (write?.kind === "insert") {
        const row = {
          id: "e0000000-0000-4000-8000-0000000000ff",
          ...write.values,
          role: write.values.role ?? null,
          email: write.values.email ?? null,
          phone: write.values.phone ?? null,
          first_name: write.values.first_name ?? null,
          last_name: write.values.last_name ?? null,
          created_at: "2026-10-14T00:00:00.000Z",
          updated_at: "2026-10-14T00:00:00.000Z",
          client: { name: "Lincoln SD" },
        };
        data[table]?.push(row);
        return [row];
      }
      const rows = matching();
      if (write?.kind === "update") for (const row of rows) Object.assign(row, write.values);
      return rows;
    };
    const builder = {
      select: (columns: string) => {
        calls.push(["select", columns]);
        return builder;
      },
      insert: (values: Row) => {
        calls.push(["insert", values]);
        write = { kind: "insert", values };
        return builder;
      },
      update: (values: Row) => {
        calls.push(["update", values]);
        write = { kind: "update", values };
        return builder;
      },
      eq: (column: string, value: unknown) => {
        calls.push(["eq", column, value]);
        filters.push((row) => row[column] === value);
        return builder;
      },
      limit: () => builder,
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      // biome-ignore lint/suspicious/noThenProperty: the Supabase builder is awaited like a promise.
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve, reject),
    };
    return builder;
  };
  return { supabase: { from, rpc }, calls, data };
}

function signIn(studioId: string, role = "owner") {
  const db = fakeDatabase();
  scope.mockResolvedValue({
    supabase: db.supabase,
    studio: { id: studioId, name: "S", slug: "s", region: "ca", role },
    userId: "u",
  });
  return db;
}

const json = (url: string, method: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /contacts (leak test)", () => {
  it("lists the caller's studio's contacts, from studioScope, with the client's name", async () => {
    const db = signIn(A, "photographer");
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/contacts?show=main"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts.map((c: { firstName: string }) => c.firstName)).toEqual(["Dana"]);
    expect(body.contacts[0]).toMatchObject({ clientName: "Lincoln SD", isMain: true });
    expect(body.total).toBe(1);
    expect(db.calls).toContainEqual([
      "rpc",
      "list_client_contacts",
      {
        p_studio_id: A,
        p_q: null,
        p_main_only: true,
        p_client_id: null,
        p_after: null,
        p_limit: 51,
      },
    ]);
  });

  it("gives studio B nothing of studio A's, even asked for A's client by id", async () => {
    signIn(B);
    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/v1/contacts?clientId=${CLIENT_A}`));
    expect(await res.json()).toEqual({ contacts: [], nextCursor: null, total: 0 });
  });

  it("takes no search text in the address", async () => {
    const db = signIn(A);
    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/v1/contacts?q=dana"));
    expect(db.calls).toContainEqual([
      "rpc",
      "list_client_contacts",
      expect.objectContaining({ p_q: null }),
    ]);
  });
});

describe("POST /contacts/search (D113)", () => {
  it("searches the caller's studio with the text from the body", async () => {
    const db = signIn(B);
    const { POST } = await import("./search/route");
    const res = await POST(json("http://localhost/api/v1/contacts/search", "POST", { q: "dana" }));
    expect(res.status).toBe(200);
    // Dana is studio A's: studio B finds nothing.
    expect((await res.json()).contacts).toEqual([]);
    expect(db.calls).toContainEqual([
      "rpc",
      "list_client_contacts",
      expect.objectContaining({ p_studio_id: B, p_q: "dana" }),
    ]);
  });

  it("finds the caller's own", async () => {
    signIn(A);
    const { POST } = await import("./search/route");
    const res = await POST(json("http://localhost/api/v1/contacts/search", "POST", { q: "DANA" }));
    expect((await res.json()).contacts.map((c: { id: string }) => c.id)).toEqual([DANA]);
  });
});

describe("POST /contacts", () => {
  it("adds a contact to one of the caller's clients, in the caller's studio", async () => {
    const db = signIn(A, "admin");
    const { POST } = await import("./route");
    const res = await POST(
      json("http://localhost/api/v1/contacts", "POST", {
        clientId: CLIENT_A,
        firstName: "Mark",
        lastName: "Ellis",
        role: "Principal",
        isMain: true,
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).contact).toMatchObject({
      clientId: CLIENT_A,
      firstName: "Mark",
      isMain: true,
    });
    expect(db.calls).toContainEqual([
      "insert",
      {
        studio_id: A,
        client_id: CLIENT_A,
        first_name: "Mark",
        last_name: "Ellis",
        role: "Principal",
        is_main: true,
      },
    ]);
  });

  it("refuses another studio's client as a field error, and adds nothing", async () => {
    const db = signIn(A);
    const { POST } = await import("./route");
    const res = await POST(
      json("http://localhost/api/v1/contacts", "POST", { clientId: CLIENT_B, firstName: "Mark" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ clientId: "validation.client" });
    expect(db.calls.filter((c) => c[0] === "insert")).toEqual([]);
  });

  it("refuses photographers and staff before reading the body", async () => {
    for (const role of ["photographer", "staff"]) {
      const db = signIn(A, role);
      const { POST } = await import("./route");
      const res = await POST(
        json("http://localhost/api/v1/contacts", "POST", { clientId: CLIENT_A, firstName: "X" }),
      );
      expect(res.status).toBe(403);
      expect(db.calls).toEqual([]);
    }
  });

  it("refuses a contact who is nobody", async () => {
    signIn(A);
    const { POST } = await import("./route");
    const res = await POST(
      json("http://localhost/api/v1/contacts", "POST", { clientId: CLIENT_A, role: "Office" }),
    );
    expect((await res.json()).error.fields).toEqual({ firstName: "validation.contactEmpty" });
  });
});

describe("PATCH /contacts/:id (leak test)", () => {
  const patch = async (id: string, body: unknown) => {
    const { PATCH } = await import("./[id]/route");
    return PATCH(json(`http://localhost/api/v1/contacts/${id}`, "PATCH", body), {
      params: Promise.resolve({ id }),
    });
  };

  it("changes the caller's studio's contact, scoped by studio", async () => {
    const db = signIn(A);
    const res = await patch(DANA, { role: "Office manager", isMain: false });
    expect(res.status).toBe(200);
    expect((await res.json()).contact).toMatchObject({ role: "Office manager", isMain: false });
    expect(db.calls).toContainEqual(["update", { role: "Office manager", is_main: false }]);
    expect(db.calls.filter((c) => c[0] === "eq" && c[1] === "studio_id")).toEqual([
      ["eq", "studio_id", A],
      ["eq", "studio_id", A],
    ]);
  });

  it("never finds another studio's contact, and changes nothing", async () => {
    const db = signIn(B);
    const res = await patch(DANA, { role: "Hacked" });
    expect(res.status).toBe(404);
    expect(db.calls.filter((c) => c[0] === "update")).toEqual([]);
    expect(db.data.client_contacts?.find((r) => r.id === DANA)?.role).toBe("Office");
  });

  it("keeps the contact someone, and its client fixed", async () => {
    signIn(A);
    const empty = await patch(DANA, {
      firstName: null,
      lastName: null,
      email: null,
    });
    expect((await empty.json()).error.fields).toEqual({ firstName: "validation.contactEmpty" });
    const moved = await patch(DANA, { clientId: CLIENT_B });
    expect(moved.status).toBe(400);
  });

  it("is for owners and admins only", async () => {
    const db = signIn(A, "staff");
    const res = await patch(DANA, { role: "X" });
    expect(res.status).toBe(403);
    expect(db.calls.filter((c) => c[0] === "update")).toEqual([]);
  });
});
