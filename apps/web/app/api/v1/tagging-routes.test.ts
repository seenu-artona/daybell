import { ApiError } from "@daybell/api";
import { encryptCardAccessCode, generateAccessCode, importAccessCodeKeys } from "@daybell/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// QR tagging routes (ADR 0018): the person, their role (owners, admins and photographers write; staff read only, plan
// answer 10) and the region are checked before the body; another studio's job is simply not found (row-level
// security, faked here) and nothing is written; refusals are named for the screen; naming a blank card's child moves
// the card's own code to the child, in memory, and logs ids only.
vi.mock("server-only", () => ({}));
const { scope, writeRpc, codeRpc, systemRpc, storage, keys } = vi.hoisted(() => ({
  scope: vi.fn(),
  writeRpc: vi.fn(),
  codeRpc: vi.fn(),
  systemRpc: vi.fn(),
  storage: { presignGet: vi.fn() },
  keys: { current: null as unknown },
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({
  photoWriteRpc: writeRpc,
  codeWriteRpc: codeRpc,
  photoSystemRpc: systemRpc,
}));
vi.mock("@/lib/access-codes", () => ({ accessCodeCryptoKeys: async () => keys.current }));
vi.mock("@daybell/config", async (original) => ({
  ...(await original<typeof import("@daybell/config")>()),
  regionDatabase: (region: string) =>
    region === "ca" ? { region, url: "http://127.0.0.1:54321", publishableKey: "pk" } : null,
}));
vi.mock("@/lib/photo-storage", () => ({
  photoStorage: () => storage,
  isLocalDriver: () => false,
  queuePhotoForProcessing: vi.fn(),
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const PHOTO = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const CHILD = "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f70";
const CARD = "3e9c0f4b-5d0a-4f88-8a3b-6c4d5e6f7081";
const BATCH = "4fad1a5c-6e1b-4a99-9b4c-7d5e6f708192";
const owner = { id: STUDIO, name: "North Peak", slug: "np", region: "ca", role: "owner" };
const staff = { ...owner, role: "staff" };
const ctx = (id: string, cardId?: string) => ({
  params: Promise.resolve({ id, cardId: cardId ?? "" }),
});

/** A stand-in for the Supabase client that answers each table (and rpc) with `rows[name]`. */
function fakeDatabase(rows: Record<string, unknown>) {
  const answer = (name: string) => {
    const chain: object = new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: rows[name] ?? null, error: null })
            : () => chain,
      },
    );
    return chain;
  };
  return { from: answer, rpc: vi.fn((name: string) => answer(name)) };
}

const garbled = (method: string) =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? null : "{ not json",
  });
const json = (body: unknown) =>
  new Request("http://localhost/api/v1/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type Route = (
  request: Request,
  ctx: { params: Promise<{ id: string; cardId: string }> },
) => Promise<Response>;
const WRITES: [string, () => Promise<Route>, string | undefined][] = [
  [
    "POST /jobs/:id/photos/move",
    async () => (await import("./jobs/[id]/photos/move/route")).POST,
    undefined,
  ],
  [
    "POST /jobs/:id/photos/confirm",
    async () => (await import("./jobs/[id]/photos/confirm/route")).POST,
    undefined,
  ],
  [
    "POST /jobs/:id/tagging/review",
    async () => (await import("./jobs/[id]/tagging/review/route")).POST,
    undefined,
  ],
  [
    "POST /jobs/:id/tagging/undo-card",
    async () => (await import("./jobs/[id]/tagging/undo-card/route")).POST,
    undefined,
  ],
  [
    "POST /jobs/:id/qr-cards/:cardId/child",
    async () => (await import("./jobs/[id]/qr-cards/[cardId]/child/route")).POST,
    CARD,
  ],
];

beforeEach(async () => {
  storage.presignGet.mockImplementation(async (key: string) => `https://s3.test/${key}?sig`);
  keys.current = await importAccessCodeKeys({
    hmacKey: crypto.getRandomValues(new Uint8Array(32)),
    encryptionKey: crypto.getRandomValues(new Uint8Array(32)),
  });
});
afterEach(() => {
  scope.mockReset();
  writeRpc.mockReset();
  codeRpc.mockReset();
  systemRpc.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("tagging writes check the person and their role before anything else (S4)", () => {
  for (const [name, load, card] of WRITES) {
    it(`${name}: signed-out people get not_signed_in, even with a broken body`, async () => {
      scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
      expect((await (await load())(garbled("POST"), ctx(JOB, card))).status).toBe(401);
    });

    it(`${name}: staff get forbidden, even with a broken body (plan answer 10)`, async () => {
      scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: staff, userId: "u" });
      expect((await (await load())(garbled("POST"), ctx(JOB, card))).status).toBe(403);
      expect(writeRpc).not.toHaveBeenCalled();
      expect(codeRpc).not.toHaveBeenCalled();
    });
  }

  it("moves, confirmations and naming a card's child refuse a Canadian studio outside Montréal before the body", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: owner, userId: "u" });
    for (const [, load, card] of WRITES.filter(([n]) => !n.includes("review"))) {
      const res = await (await load())(garbled("POST"), ctx(JOB, card));
      expect(res.status).toBe(422);
    }
    expect(writeRpc).not.toHaveBeenCalled();
    expect(codeRpc).not.toHaveBeenCalled();
  });

  it("route files that touch storage or codes run in Montréal (preferredRegion yul1)", async () => {
    for (const mod of [
      await import("./jobs/[id]/tagging/route"),
      await import("./jobs/[id]/tagging/photos/route"),
      await import("./jobs/[id]/photos/move/route"),
      await import("./jobs/[id]/photos/confirm/route"),
      await import("./jobs/[id]/tagging/undo-card/route"),
      await import("./jobs/[id]/qr-cards/[cardId]/child/route"),
      // Database only, but in Montréal like their siblings (security review 12, code review nice 7).
      await import("./jobs/[id]/tagging/review/route"),
    ])
      expect(mod.preferredRegion).toBe("yul1");
  });

  it("Mark reviewed refuses a Canadian studio outside Montréal", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    scope.mockResolvedValue({
      supabase: fakeDatabase({ jobs: { id: JOB, status: "draft" } }),
      studio: owner,
      userId: "u",
    });
    const review = (await import("./jobs/[id]/tagging/review/route")).POST;
    expect((await review(json({}), ctx(JOB))).status).toBe(422);
    expect(writeRpc).not.toHaveBeenCalled();
  });
});

describe("another studio's job is not found, and nothing is written or signed (leak, D96)", () => {
  beforeEach(() =>
    scope.mockResolvedValue({
      supabase: fakeDatabase({}),
      studio: { ...owner, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      userId: "b",
    }),
  );

  it("the review's reads", async () => {
    const get = (url: string) => new Request(`http://localhost/api/v1/jobs/${JOB}/${url}`);
    for (const [load, url] of [
      [async () => (await import("./jobs/[id]/tagging/route")).GET, "tagging"],
      [
        async () => (await import("./jobs/[id]/tagging/photos/route")).GET,
        "tagging/photos?place=leftovers",
      ],
    ] as const)
      expect((await (await load())(get(url), ctx(JOB))).status).toBe(404);
    expect(storage.presignGet).not.toHaveBeenCalled();
  });

  it("the review's writes", async () => {
    const move = (await import("./jobs/[id]/photos/move/route")).POST;
    const confirm = (await import("./jobs/[id]/photos/confirm/route")).POST;
    const review = (await import("./jobs/[id]/tagging/review/route")).POST;
    const claim = (await import("./jobs/[id]/qr-cards/[cardId]/child/route")).POST;
    const undo = (await import("./jobs/[id]/tagging/undo-card/route")).POST;
    expect(
      (await move(json({ photoIds: [PHOTO], target: { kind: "leftovers" } }), ctx(JOB))).status,
    ).toBe(404);
    expect((await confirm(json({ photoIds: [PHOTO] }), ctx(JOB))).status).toBe(404);
    expect((await undo(json({ photoIds: [PHOTO] }), ctx(JOB))).status).toBe(404);
    expect((await review(json({}), ctx(JOB))).status).toBe(404);
    expect((await claim(json({ firstName: "Zoe", lastName: "New" }), ctx(JOB, CARD))).status).toBe(
      404,
    );
    expect(writeRpc).not.toHaveBeenCalled();
    expect(codeRpc).not.toHaveBeenCalled();
  });
});

describe("moving and confirming", () => {
  beforeEach(() =>
    scope.mockResolvedValue({
      supabase: fakeDatabase({ jobs: { id: JOB, status: "draft" } }),
      studio: { ...owner, role: "photographer" },
      userId: "u",
    }),
  );

  it("moves photos to a child, sending ids only", async () => {
    writeRpc.mockResolvedValue({ data: 2, error: null });
    const move = (await import("./jobs/[id]/photos/move/route")).POST;
    const res = await move(
      json({ photoIds: [PHOTO, CARD], target: { kind: "child", childId: CHILD } }),
      ctx(JOB),
    );
    expect(await res.json()).toEqual({ moved: 2 });
    expect(writeRpc).toHaveBeenCalledWith("ca", "move_photos", "u", {
      p_job_id: JOB,
      p_photo_ids: [PHOTO, CARD],
      p_target: { kind: "child", id: CHILD },
    });
  });

  it("refuses card photos by name, so the screen can say why", async () => {
    writeRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "card_photo" } });
    const move = (await import("./jobs/[id]/photos/move/route")).POST;
    const res = await move(json({ photoIds: [PHOTO], target: { kind: "leftovers" } }), ctx(JOB));
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "tagging.cardPhoto" });
  });

  it("refuses Looks right on Leftovers by name (C9), as the screens do", async () => {
    writeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "leftovers_confirm" },
    });
    const confirm = (await import("./jobs/[id]/photos/confirm/route")).POST;
    const res = await confirm(json({ photoIds: [PHOTO] }), ctx(JOB));
    expect([res.status, (await res.json()).error.fields]).toEqual([
      409,
      { form: "tagging.leftovers" },
    ]);
  });

  it("never gives a group photo to a person (C8), and takes no class photo set as a target", async () => {
    writeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "group_photo" },
    });
    const move = (await import("./jobs/[id]/photos/move/route")).POST;
    const res = await move(
      json({ photoIds: [PHOTO], target: { kind: "child", childId: CHILD } }),
      ctx(JOB),
    );
    expect([res.status, (await res.json()).error.fields]).toEqual([
      409,
      { form: "tagging.groupPhoto" },
    ]);
    writeRpc.mockClear();
    expect(
      (
        await move(
          json({ photoIds: [PHOTO], target: { kind: "classSet", groupId: CHILD } }),
          ctx(JOB),
        )
      ).status,
    ).toBe(400);
    expect(writeRpc).not.toHaveBeenCalled();
  });

  it("refuses more than 500 photos, or a target that isn't one", async () => {
    const move = (await import("./jobs/[id]/photos/move/route")).POST;
    const many = Array.from(
      { length: 501 },
      (_, i) => `1c7a8d2f-3b8e-4d66-8e1f-${String(i).padStart(12, "0")}`,
    );
    expect(
      (await move(json({ photoIds: many, target: { kind: "leftovers" } }), ctx(JOB))).status,
    ).toBe(400);
    expect(
      (await move(json({ photoIds: [PHOTO], target: { kind: "card" } }), ctx(JOB))).status,
    ).toBe(400);
    expect(writeRpc).not.toHaveBeenCalled();
  });

  it("confirms flagged photos, or marks them card photos", async () => {
    writeRpc.mockResolvedValue({ data: 1, error: null });
    const confirm = (await import("./jobs/[id]/photos/confirm/route")).POST;
    expect(
      await (await confirm(json({ photoIds: [PHOTO], asCard: true }), ctx(JOB))).json(),
    ).toEqual({
      confirmed: 1,
    });
    expect(writeRpc).toHaveBeenCalledWith("ca", "confirm_photos", "u", {
      p_job_id: JOB,
      p_photo_ids: [PHOTO],
      p_as_card: true,
    });
  });

  it("names photos that must be confirmed first, and another job's card photos (code review M1)", async () => {
    const move = (await import("./jobs/[id]/photos/move/route")).POST;
    const confirm = (await import("./jobs/[id]/photos/confirm/route")).POST;
    writeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "confirm_first" },
    });
    const res = await move(json({ photoIds: [PHOTO], target: { kind: "leftovers" } }), ctx(JOB));
    expect([res.status, (await res.json()).error.fields]).toEqual([
      409,
      { form: "tagging.confirmFirst" },
    ]);
    writeRpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "other_card" } });
    const other = await confirm(json({ photoIds: [PHOTO], asCard: false }), ctx(JOB));
    expect([other.status, (await other.json()).error.fields]).toEqual([
      409,
      { form: "tagging.otherCard" },
    ]);
  });

  it("lets only owners and admins undo a card photo mark: photographers get forbidden (answer 12)", async () => {
    const undo = (await import("./jobs/[id]/tagging/undo-card/route")).POST;
    expect((await undo(json({ photoIds: [PHOTO] }), ctx(JOB))).status).toBe(403);
    expect((await undo(garbled("POST"), ctx(JOB))).status).toBe(403);
    expect(writeRpc).not.toHaveBeenCalled();
  });

  it("undoes card photo marks for an owner or admin, sending ids only (answer 12)", async () => {
    const undo = (await import("./jobs/[id]/tagging/undo-card/route")).POST;
    for (const role of ["owner", "admin"]) {
      scope.mockResolvedValue({
        supabase: fakeDatabase({ jobs: { id: JOB, status: "draft" } }),
        studio: { ...owner, role },
        userId: "u",
      });
      writeRpc.mockResolvedValueOnce({ data: 1, error: null });
      const res = await undo(json({ photoIds: [PHOTO] }), ctx(JOB));
      expect([res.status, await res.json()]).toEqual([200, { undone: 1 }]);
    }
    expect(writeRpc).toHaveBeenCalledWith("ca", "undo_card_photos", "u", {
      p_job_id: JOB,
      p_photo_ids: [PHOTO],
    });
    writeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "not_marked_card" },
    });
    const refused = await undo(json({ photoIds: [PHOTO] }), ctx(JOB));
    expect([refused.status, (await refused.json()).error.fields]).toEqual([
      409,
      { form: "tagging.notMarkedCard" },
    ]);
    expect((await undo(json({ photoIds: [] }), ctx(JOB))).status).toBe(400);
  });

  it("refuses Mark reviewed while tagging isn't clean", async () => {
    writeRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "tagging_not_ready" },
    });
    const review = (await import("./jobs/[id]/tagging/review/route")).POST;
    const res = await review(new Request("http://localhost/x", { method: "POST" }), ctx(JOB));
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "tagging.notReady" });
  });
});

describe("naming a blank card's child (answer 2; ADR 0015's order)", () => {
  const claim = async (body: unknown) =>
    (await import("./jobs/[id]/qr-cards/[cardId]/child/route")).POST(json(body), ctx(JOB, CARD));
  const row = {
    id: CHILD,
    job_id: JOB,
    group_id: null,
    first_name: "Zoe",
    last_name: "New",
    student_id: null,
    grade: null,
    parent_email: null,
    do_not_photograph: false,
    do_not_publish: false,
    school_provided: true,
    created_at: "2026-10-12T10:00:00Z",
    updated_at: "2026-10-12T10:00:00Z",
  };

  it("moves the card's own code to the new child, re-encrypted for the child, and logs nothing", async () => {
    const k = keys.current as Awaited<ReturnType<typeof importAccessCodeKeys>>;
    const code = generateAccessCode("ca");
    const cardCopy = await encryptCardAccessCode(code, CARD, k.encryption);
    let childCopy = "";
    systemRpc.mockResolvedValue({ data: null, error: null });
    codeRpc.mockImplementation(async (_r, fn, _u, args) => {
      if (fn === "blank_card_code") return { data: cardCopy, error: null };
      childCopy = args.p_child.access_code_ciphertext;
      row.id = args.p_child.id;
      return { data: args.p_child.id, error: null };
    });
    const log = vi.spyOn(console, "error");
    // Row-level security reads: the job, then the new child (one row) and the roster (a list).
    const from = (name: string) => {
      let single = false;
      const chain: object = new Proxy(
        {},
        {
          get: (_t, prop: string) => {
            if (prop === "single") {
              single = true;
              return () => chain;
            }
            if (prop !== "then") return () => chain;
            const data =
              name === "jobs"
                ? { id: JOB, status: "draft" }
                : name === "children"
                  ? single
                    ? { ...row, access_code_ciphertext: childCopy }
                    : []
                  : name === "upload_batches"
                    ? [
                        { id: BATCH, tag_round: 3, tagged_round: 2 },
                        { id: PHOTO, tag_round: 1, tagged_round: 1 },
                      ]
                    : null;
            return (resolve: (v: unknown) => void) => resolve({ data, error: null });
          },
        },
      );
      return chain;
    };
    scope.mockResolvedValue({ supabase: { from, rpc: vi.fn() }, studio: owner, userId: "u" });
    const res = await claim({ firstName: "Zoe", lastName: "New" });
    expect(res.status).toBe(201);
    const { child } = await res.json();
    expect(child.accessCode?.replace("-", "")).toBe(code);
    expect(codeRpc).toHaveBeenCalledWith("ca", "claim_blank_card", "u", {
      p_job_id: JOB,
      p_card_id: CARD,
      p_child: expect.objectContaining({ first_name: "Zoe", last_name: "New", group_id: null }),
    });
    expect(childCopy).not.toBe(cardCopy);
    expect(JSON.stringify(log.mock.calls)).not.toContain(code);
    // The card's batches are due again (code review M2): tagged now, so Mark reviewed doesn't wait for the sweep.
    expect(systemRpc.mock.calls).toEqual([["ca", "tagging_inputs", { p_batch_id: BATCH }]]);
  });

  it("refuses a card already claimed, by name", async () => {
    codeRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "card_claimed" } });
    scope.mockResolvedValue({
      supabase: fakeDatabase({ jobs: { id: JOB, status: "draft" } }),
      studio: owner,
      userId: "u",
    });
    const res = await claim({ firstName: "Zoe", lastName: "New" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "tagging.cardClaimed" });
  });

  it("never claims a card whose code can't be read, logging the card's id only", async () => {
    codeRpc.mockResolvedValueOnce({ data: `v1.${"A".repeat(48)}`, error: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    scope.mockResolvedValue({
      supabase: fakeDatabase({ jobs: { id: JOB, status: "draft" } }),
      studio: owner,
      userId: "u",
    });
    const res = await claim({ firstName: "Zoe", lastName: "New" });
    expect(res.status).toBe(409);
    expect(log).toHaveBeenCalledWith("access_code_unreadable", CARD);
    expect(codeRpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a name the roster wouldn't take, and a malformed card id", async () => {
    scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: owner, userId: "u" });
    expect((await claim({ firstName: "", lastName: "New" })).status).toBe(400);
    const res = await (await import("./jobs/[id]/qr-cards/[cardId]/child/route")).POST(
      json({ firstName: "Zoe", lastName: "New" }),
      ctx(JOB, "../x"),
    );
    expect(res.status).toBe(404);
    expect(codeRpc).not.toHaveBeenCalled();
  });
});

describe("the review's summary", () => {
  it("says whether Mark reviewed is possible, and why not, from core's rules", async () => {
    const supabase = fakeDatabase({
      jobs: { id: JOB, status: "draft" },
      job_tagging_overview: {
        photos: 10,
        processing: 0,
        failed: 1,
        untagged_batches: 0,
        leftovers: 2,
        flagged: 0,
        blank_cards: 1,
        card_photos: 3,
        reviewed_at: null,
      },
      tagging_blank_cards: [{ card_id: CARD, photos: 2, card_photo_id: PHOTO }],
    });
    scope.mockResolvedValue({ supabase, studio: staff, userId: "u" });
    const res = await (await import("./jobs/[id]/tagging/route")).GET(
      new Request("http://localhost/x"),
      ctx(JOB),
    );
    const { tagging } = await res.json();
    expect(tagging).toMatchObject({
      leftovers: 2,
      blankCards: 1,
      canMarkReviewed: false,
      notReviewable: "leftovers",
      done: false,
    });
    // Class albums and No photos yet left Photos (C17).
    expect(tagging).not.toHaveProperty("albums");
    expect(tagging).not.toHaveProperty("noPhotos");
    expect(tagging.blankCardGroups[0].cardPhotoUrl).toContain(`/${PHOTO}/thumb.webp`);
  });
});

describe("starting an upload (code review S1)", () => {
  const GROUP = "4fad1a5c-6e1b-4a99-9b4c-7d5e6f708192";
  const start = async (request: Request) =>
    (await import("./jobs/[id]/upload-batches/route")).POST(request, ctx(JOB));
  /** A body streamed in chunks, as public API clients over HTTP/2 send it: no content-length. */
  const chunked = (text: string) =>
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

  beforeEach(() => {
    scope.mockResolvedValue({
      supabase: fakeDatabase({
        jobs: { id: JOB, status: "draft" },
        job_groups: { id: GROUP, name: "Room 4" },
      }),
      studio: owner,
      userId: "u",
    });
    writeRpc.mockResolvedValue({ data: PHOTO, error: null });
  });

  it("keeps a group upload's group when the body has no content-length (ADR 0030)", async () => {
    const req = chunked(JSON.stringify({ kind: "group", groupId: GROUP }));
    expect(req.headers.get("content-length")).toBeNull();
    expect((await start(req)).status).toBe(201);
    expect(writeRpc).toHaveBeenCalledWith("ca", "create_upload_batch", "u", {
      p_job_id: JOB,
      p_kind: "group",
      p_photo_group_id: GROUP,
      p_add_to_group_id: null,
    });
  });

  it("passes an individual upload's add-to group (C7)", async () => {
    expect((await start(json({ addToGroupId: GROUP }))).status).toBe(201);
    expect(writeRpc).toHaveBeenCalledWith("ca", "create_upload_batch", "u", {
      p_job_id: JOB,
      p_kind: "individual",
      p_photo_group_id: null,
      p_add_to_group_id: GROUP,
    });
  });

  it("treats an empty body, sent either way, as an upload of individual photos", async () => {
    expect((await start(new Request("http://localhost/x", { method: "POST" }))).status).toBe(201);
    expect((await start(chunked(""))).status).toBe(201);
    for (const call of writeRpc.mock.calls)
      expect(call[3]).toEqual({
        p_job_id: JOB,
        p_kind: "individual",
        p_photo_group_id: null,
        p_add_to_group_id: null,
      });
  });

  it("names another job's group a groups.notInJob conflict, and refuses an old class-photo body", async () => {
    writeRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "group_not_in_job" },
    });
    const res = await start(json({ kind: "group", groupId: GROUP }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "groups.notInJob" });
    writeRpc.mockClear();
    expect((await start(json({ groupId: GROUP }))).status).toBe(400);
    expect(writeRpc).not.toHaveBeenCalled();
  });

  it("refuses a body that isn't JSON, however it was sent", async () => {
    expect((await start(chunked("{ not json"))).status).toBe(400);
    expect(writeRpc).not.toHaveBeenCalled();
  });
});
