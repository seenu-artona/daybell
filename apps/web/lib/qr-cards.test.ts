import { encryptAccessCode, importAccessCodeKeys } from "@daybell/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Server helpers for QR cards (ADR 0015): the database arguments carry IDs only, a taken code tries again with new
// blank cards, named database failures become clear API errors, and an unreadable code leaves its card out (counted,
// only the child's id logged).
vi.mock("server-only", () => ({}));
const {
  assertPrintRegion,
  blankCardMaker,
  loadCardChildren,
  pdfFilename,
  prepareArgs,
  prepareWithRetries,
  printCards,
} = await import("./qr-cards");

const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const G1 = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const random32 = () => crypto.getRandomValues(new Uint8Array(32));

afterEach(() => vi.restoreAllMocks());

describe("prepareArgs", () => {
  const blank = { id: "card-1", code: "K7QM4XPA", hash: "h".repeat(64), ciphertext: "v1.x" };

  it("prints the whole job with blank cards, never sending a code itself", () => {
    const args = prepareArgs(JOB, { blankCards: 1 }, [blank]);
    expect(args).toEqual({
      p_job_id: JOB,
      p_group_ids: null,
      p_no_group: false,
      p_child_id: null,
      p_blanks: [{ id: "card-1", access_code_hash: blank.hash, access_code_ciphertext: "v1.x" }],
    });
    expect(JSON.stringify(args)).not.toContain("K7QM4XPA");
  });

  it('sends chosen classes and "no class" apart', () => {
    expect(prepareArgs(JOB, { groupIds: [G1, "none"], blankCards: 0 }, [])).toMatchObject({
      p_group_ids: [G1],
      p_no_group: true,
    });
    expect(prepareArgs(JOB, { groupIds: ["none"], blankCards: 0 }, [])).toMatchObject({
      p_group_ids: [],
      p_no_group: true,
    });
    expect(prepareArgs(JOB, { childId: G1, blankCards: 0 }, [])).toMatchObject({
      p_group_ids: null,
      p_child_id: G1,
    });
  });
});

describe("prepareWithRetries", () => {
  const prepared = { cards: [], blanks: [], new_cards: 0 };
  const collision = (message: string) => ({ data: null, error: { code: "P0001", message } });

  it("tries again with new blank cards when a code or card code is taken", async () => {
    const make = vi.fn(blankCardMaker(2, async () => ({ code: "C", hash: "h", ciphertext: "x" })));
    const send = vi
      .fn()
      .mockResolvedValueOnce(collision("access_code_collision"))
      .mockResolvedValueOnce(collision("card_code_collision"))
      .mockResolvedValueOnce({ data: prepared, error: null });
    const result = await prepareWithRetries(make, send);
    expect(result.prepared).toBe(prepared);
    expect(send).toHaveBeenCalledTimes(3);
    const ids = send.mock.calls.flatMap(([blanks]) => blanks.map((b: { id: string }) => b.id));
    expect(new Set(ids).size).toBe(6);
  });

  it("gives up after three taken codes", async () => {
    const send = vi.fn().mockResolvedValue(collision("access_code_collision"));
    await expect(prepareWithRetries(blankCardMaker(0, vi.fn()), send)).rejects.toMatchObject({
      code: "internal",
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("turns the database's named failures into clear API errors", async () => {
    const fails = (error: { code: string; message: string }) =>
      prepareWithRetries(blankCardMaker(0, vi.fn()), async () => ({ data: null, error }));
    await expect(fails({ code: "P0001", message: "do_not_photograph" })).rejects.toMatchObject({
      code: "conflict",
      fields: { form: "qrCards.doNotPhotograph" },
    });
    await expect(fails({ code: "P0001", message: "nothing_to_print" })).rejects.toMatchObject({
      code: "conflict",
      fields: { form: "qrCards.nothingToPrint" },
    });
    await expect(fails({ code: "P0002", message: "Job not found" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(fails({ code: "22023", message: "x" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(fails({ code: "42501", message: "x" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("printCards", () => {
  it("sorts children by class, adds blank cards last, and leaves out unreadable codes (counted)", async () => {
    const keys = await importAccessCodeKeys({ hmacKey: random32(), encryptionKey: random32() });
    const row = async (id: string, first: string, last: string, group: string | null) => ({
      id,
      group_id: group,
      first_name: first,
      last_name: last,
      do_not_photograph: false,
      access_code_ciphertext: await encryptAccessCode("K7QM4XPA", id, keys.encryption),
    });
    const children = [
      await row("c1", "Maya", "Johnson", "g10"),
      await row("c2", "Liam", "Chen", "g2"),
      await row("c3", "Noah", "Garcia", null),
      { ...(await row("c4", "Ava", "Patel", "g2")), access_code_ciphertext: "v1.broken" },
    ];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cards, skipped } = await printCards({
      prepared: {
        cards: ["c1", "c2", "c3", "c4"].map((id, n) => ({
          child_id: id,
          card_code: String(n).padStart(20, "0"),
        })),
        blanks: [{ id: "b1", card_code: "ABCDEFGHJKMNPQRSTVWX" }],
        new_cards: 4,
      },
      blanks: [{ id: "b1", code: "JKMNPQRS", hash: "h", ciphertext: "x" }],
      children,
      groups: [
        { id: "g10", name: "Room 10" },
        { id: "g2", name: "Room 2" },
      ],
      keys,
    });
    expect(cards.map((c) => c.child?.firstName ?? "blank")).toEqual([
      "Liam",
      "Maya",
      "Noah",
      "blank",
    ]);
    expect(cards[0]).toEqual({
      child: { firstName: "Liam", lastName: "Chen", group: "Room 2" },
      qrPayload: "DBC1:00000000000000000001",
      accessCode: "K7QM-4XPA",
    });
    expect(cards[3]).toEqual({
      child: null,
      qrPayload: "DBC1:ABCDEFGHJKMNPQRSTVWX",
      accessCode: "JKMN-PQRS",
    });
    expect(skipped).toBe(1);
    expect(errors).toHaveBeenCalledWith("access_code_unreadable", "c4");
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/Ava|Patel|broken/);
  });
});

describe("printCards and Do not photograph", () => {
  it("leaves out a child marked Do not photograph after the cards were prepared (S2)", async () => {
    const keys = await importAccessCodeKeys({ hmacKey: random32(), encryptionKey: random32() });
    const { cards, skipped } = await printCards({
      prepared: {
        cards: [{ child_id: "c1", card_code: "0".repeat(20) }],
        blanks: [],
        new_cards: 0,
      },
      blanks: [],
      children: [
        {
          id: "c1",
          group_id: null,
          first_name: "Zoe",
          last_name: "Optout",
          do_not_photograph: true,
          access_code_ciphertext: await encryptAccessCode("K7QM4XPA", "c1", keys.encryption),
        },
      ],
      groups: [],
      keys,
    });
    expect(cards).toEqual([]);
    expect(skipped).toBe(0);
  });
});

describe("loadCardChildren", () => {
  /** Records each query's filters and answers with no rows. */
  function fake() {
    const queries: [string, unknown[]][][] = [];
    const supabase = {
      from: () => {
        const ops: [string, unknown[]][] = [];
        queries.push(ops);
        const chain: object = new Proxy(
          {},
          {
            get: (_t, prop: string) =>
              prop === "then"
                ? (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
                : (...args: unknown[]) => {
                    ops.push([prop, args]);
                    return chain;
                  },
          },
        );
        return chain;
      },
    };
    return { supabase: supabase as never, queries };
  }

  it("reads one child's card by id only, never the whole job (S7)", async () => {
    const db = fake();
    await loadCardChildren(db.supabase, "studio-a", JOB, ["c1"]);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]).toContainEqual(["in", ["id", ["c1"]]]);
    expect(db.queries[0]).toContainEqual(["eq", ["studio_id", "studio-a"]]);
  });

  it("reads ids in chunks of 100, and a big print by pages of the job", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `c${i}`);
    const chunked = fake();
    await loadCardChildren(chunked.supabase, "studio-a", JOB, ids);
    expect(
      chunked.queries.map(
        (q) => (q.find(([op]) => op === "in")?.[1][1] as string[] | undefined)?.length,
      ),
    ).toEqual([100, 100, 50]);
    const paged = fake();
    await loadCardChildren(
      paged.supabase,
      "studio-a",
      JOB,
      Array.from({ length: 1001 }, (_, i) => `c${i}`),
    );
    expect(paged.queries).toHaveLength(1);
    expect(paged.queries[0]?.some(([op]) => op === "in")).toBe(false);
  });
});

describe("assertPrintRegion (S1, D113)", () => {
  it("builds Canadian studios' cards only in Montréal when on Vercel", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertPrintRegion("ca", { VERCEL_REGION: "iad1" })).toThrow(
      expect.objectContaining({ code: "region_unavailable" }),
    );
    expect(() => assertPrintRegion("ca", { VERCEL_REGION: "yul1" })).not.toThrow();
    // Not on Vercel (local and CI): no function region to check.
    expect(() => assertPrintRegion("ca", {})).not.toThrow();
    // US studios: no US function region yet (ADR 0015 follow-up).
    expect(() => assertPrintRegion("us", { VERCEL_REGION: "yul1" })).not.toThrow();
  });
});

describe("pdfFilename", () => {
  it("is made from the internal number, with nothing a header or file system could misread", () => {
    expect(pdfFilename("JOB00042")).toBe("qr-cards-JOB00042.pdf");
    expect(pdfFilename('Fall "26" / Lincoln')).toBe("qr-cards-Fall-26-Lincoln.pdf");
    expect(pdfFilename("///")).toBe("qr-cards.pdf");
  });
});
