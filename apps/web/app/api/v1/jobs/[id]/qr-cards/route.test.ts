import { importAccessCodeKeys } from "@daybell/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// POST /jobs/:id/qr-cards (ADR 0015): a single child marked Do not photograph gets no card, classes must be the job's,
// and a print answers with a PDF download that is never cached, with counts (never names or codes) in its headers.
// The scope, database and service role are faked.
vi.mock("server-only", () => ({}));
const { scope, rpc } = vi.hoisted(() => ({ scope: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({ codeWriteRpc: rpc }));
const random32 = () => crypto.getRandomValues(new Uint8Array(32));
const keys = importAccessCodeKeys({ hmacKey: random32(), encryptionKey: random32() });
vi.mock("@/lib/access-codes", async (original) => ({
  ...(await original<typeof import("@/lib/access-codes")>()),
  accessCodeCryptoKeys: () => keys,
}));

const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const CHILD = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const OWNER = { id: "studio-a", name: "North Peak", slug: "a", region: "ca", role: "owner" };
const ctx = { params: Promise.resolve({ id: JOB }) };

/** A stand-in for the Supabase client that answers each table with `rows[table]`. */
function fakeDatabase(rows: Record<string, unknown>) {
  const from = (table: string) => {
    const chain: object = new Proxy(
      {},
      {
        get: (_target, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? null, error: null })
            : () => chain,
      },
    );
    return chain;
  };
  return { from, rpc: vi.fn() };
}

const print = async (body: unknown) =>
  (await import("./route")).POST(
    new Request(`http://localhost/api/v1/jobs/${JOB}/qr-cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );

const JOB_ROW = { id: JOB, type: "sports", internal_number: "JOB00042" };

afterEach(() => {
  scope.mockReset();
  rpc.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /jobs/:id/qr-cards", () => {
  it("refuses a single card for a child marked Do not photograph, before making any card", async () => {
    const supabase = fakeDatabase({
      jobs: JOB_ROW,
      children: { id: CHILD, do_not_photograph: true },
    });
    scope.mockResolvedValue({ supabase, studio: OWNER, userId: "u" });
    const res = await print({ childId: CHILD });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "qrCards.doNotPhotograph" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses classes that aren't the job's", async () => {
    const supabase = fakeDatabase({ jobs: JOB_ROW, job_groups: [] });
    scope.mockResolvedValue({ supabase, studio: OWNER, userId: "u" });
    const res = await print({ groupIds: [CHILD] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ groupIds: "validation.group" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a Canadian studio's print outside Montréal, before reading the body (S1, D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    scope.mockResolvedValue({
      supabase: fakeDatabase({ jobs: JOB_ROW }),
      studio: OWNER,
      userId: "u",
    });
    const res = await (await import("./route")).POST(
      new Request(`http://localhost/api/v1/jobs/${JOB}/qr-cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("region_unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("builds in Montréal (preferredRegion yul1)", async () => {
    expect((await import("./route")).preferredRegion).toBe("yul1");
  });

  it("says when every card's code is unreadable, with how many, after no card was printed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = fakeDatabase({
      jobs: JOB_ROW,
      job_groups: [],
      children: [
        {
          id: CHILD,
          group_id: null,
          first_name: "Maya",
          last_name: "Johnson",
          do_not_photograph: false,
          access_code_ciphertext: "v1.broken",
        },
      ],
    });
    scope.mockResolvedValue({ supabase, studio: OWNER, userId: "u" });
    rpc.mockResolvedValue({
      data: { cards: [{ child_id: CHILD, card_code: "0".repeat(20) }], blanks: [], new_cards: 0 },
      error: null,
    });
    const res = await print({});
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "qrCards.codesUnreadable" });
    expect(res.headers.get("daybell-cards-skipped")).toBe("1");
  });

  it("fails on a bad SHOP_URL before making any card or recording a print (S3)", async () => {
    vi.stubEnv("SHOP_URL", "not a url");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    scope.mockResolvedValue({
      supabase: fakeDatabase({ jobs: JOB_ROW, job_groups: [] }),
      studio: OWNER,
      userId: "u",
    });
    const res = await print({ blankCards: 5 });
    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith("shop_url_invalid");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("not a url");
  });

  it("refuses more than 100 blank cards", async () => {
    scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: OWNER, userId: "u" });
    expect((await print({ blankCards: 101 })).status).toBe(400);
  });

  it("answers another studio's job (not visible through RLS) with not_found", async () => {
    scope.mockResolvedValue({ supabase: fakeDatabase({ jobs: null }), studio: OWNER, userId: "u" });
    expect((await print({})).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("prints the job's cards and blank cards as a PDF download, for the signed-in person", async () => {
    const { encryptAccessCode } = await import("@daybell/core");
    const ciphertext = await encryptAccessCode("K7QM4XPA", CHILD, (await keys).encryption);
    const supabase = fakeDatabase({
      jobs: JOB_ROW,
      job_groups: [{ id: "g1", name: "Hawks" }],
      children: [
        {
          id: CHILD,
          group_id: "g1",
          first_name: "Maya",
          last_name: "Johnson",
          do_not_photograph: false,
          access_code_ciphertext: ciphertext,
        },
      ],
    });
    scope.mockResolvedValue({ supabase, studio: OWNER, userId: "user-1" });
    rpc.mockImplementation(async (_region, _fn, _actor, args) => ({
      data: {
        cards: [{ child_id: CHILD, card_code: "0".repeat(20) }],
        blanks: args.p_blanks.map((b: { id: string }) => ({ id: b.id, card_code: "1".repeat(20) })),
        new_cards: 1,
      },
      error: null,
    }));
    const res = await print({ blankCards: 2 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="qr-cards-JOB00042.pdf"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("daybell-cards")).toBe("3");
    expect(res.headers.get("daybell-cards-skipped")).toBe("0");
    expect(res.headers.get("daybell-cards-replaced-characters")).toBe("0");
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");

    const [region, fn, actor, args] = rpc.mock.calls[0] ?? [];
    expect([region, fn, actor]).toEqual(["ca", "prepare_qr_cards", "user-1"]);
    expect(args).toMatchObject({ p_job_id: JOB, p_group_ids: null, p_child_id: null });
    expect(args.p_blanks).toHaveLength(2);
    // Hashes and encrypted copies go to the database; the codes themselves never do.
    for (const blank of args.p_blanks) {
      expect(Object.keys(blank).sort()).toEqual([
        "access_code_ciphertext",
        "access_code_hash",
        "id",
      ]);
      expect(blank.access_code_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
