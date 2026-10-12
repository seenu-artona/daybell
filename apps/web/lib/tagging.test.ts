import { afterEach, describe, expect, it, vi } from "vitest";

// QR tagging on the server (ADR 0018): database rows to core's rules and back, runs for the round they read (retried
// when it moves on, left to the daily sweep after three tries), and logs with ids only.
vi.mock("server-only", () => ({}));
const { systemRpc } = vi.hoisted(() => ({ systemRpc: vi.fn() }));
vi.mock("./supabase/service", () => ({ photoSystemRpc: systemRpc, photoWriteRpc: vi.fn() }));
const {
  beforeStep,
  planBatch,
  photoQr,
  qrKindOf,
  tagBatchNow,
  tagBatchesOfPhotos,
  taggingError,
  targetRow,
  toTaggedPhoto,
  writeRow,
} = await import("./tagging");
type Inputs = Parameters<typeof planBatch>[0];

const CHILD = "c1000000-0000-4000-8000-000000000001";
const CARD = "f1000000-0000-4000-8000-000000000001";
const BLANK = "f1000000-0000-4000-8000-000000000003";
const BATCH = "a2000000-0000-4000-8000-000000000001";

const photo = (
  id: string,
  over: Partial<Inputs["photos"][number]> = {},
): Inputs["photos"][number] => ({
  id,
  status: "ready",
  qr_kind: "none",
  card_id: null,
  card_child_id: null,
  binned: false,
  before: null,
  tag: null,
  ...over,
});

const inputs = (photos: Inputs["photos"], over: Partial<Inputs> = {}): Inputs => ({
  batch_id: BATCH,
  group_id: null,
  tag_round: 3,
  tagged_round: 2,
  processing: 0,
  processing_stuck: 0,
  photos,
  ...over,
});

afterEach(() => {
  systemRpc.mockReset();
  vi.restoreAllMocks();
});

describe("photoQr", () => {
  it("maps what the worker read to tagging's terms; a deleted card is another job's card", () => {
    expect(photoQr(photo("p", { qr_kind: null }))).toBeNull();
    expect(photoQr(photo("p"))).toEqual({ kind: "none" });
    expect(photoQr(photo("p", { qr_kind: "unreadable" }))).toEqual({ kind: "unreadable" });
    expect(photoQr(photo("p", { qr_kind: "other_card" }))).toEqual({ kind: "otherCard" });
    expect(photoQr(photo("p", { qr_kind: "card", card_id: CARD, card_child_id: CHILD }))).toEqual({
      kind: "card",
      cardId: CARD,
      childId: CHILD,
    });
    expect(photoQr(photo("p", { qr_kind: "card", card_id: null }))).toEqual({ kind: "otherCard" });
  });
});

describe("planBatch and writeRow", () => {
  it("tags a batch from database rows and writes database names", () => {
    const writes = planBatch(
      inputs([
        photo("p1"),
        photo("p2", { qr_kind: "card", card_id: CARD, card_child_id: CHILD }),
        photo("p3"),
        photo("p4", { qr_kind: "card", card_id: BLANK, card_child_id: null }),
        photo("p5", { qr_kind: "unreadable" }),
        photo("p6", { status: "failed", qr_kind: null }),
      ]),
    ).map(writeRow);
    expect(writes).toEqual([
      {
        photo_id: "p1",
        place: "leftovers",
        child_id: null,
        group_id: null,
        card_id: null,
        flag: null,
      },
      { photo_id: "p2", place: "card", child_id: null, group_id: null, card_id: CARD, flag: null },
      {
        photo_id: "p3",
        place: "child",
        child_id: CHILD,
        group_id: null,
        card_id: null,
        flag: null,
      },
      { photo_id: "p4", place: "card", child_id: null, group_id: null, card_id: BLANK, flag: null },
      {
        photo_id: "p5",
        place: "blank_card",
        child_id: null,
        group_id: null,
        card_id: BLANK,
        flag: "unreadable_card",
      },
    ]);
  });

  it("skips what is already right and what people moved by hand; removes a stale automatic tag", () => {
    const tag = (place: string, source: "auto" | "manual", child: string | null = null) => ({
      place,
      child_id: child,
      group_id: null,
      card_id: null,
      flag: null,
      source,
    });
    const writes = planBatch(
      inputs([
        photo("p1", { tag: tag("child", "manual", CHILD) }),
        photo("p2", { tag: tag("leftovers", "auto") }),
        photo("p3", { status: "failed", qr_kind: null, tag: tag("leftovers", "auto") }),
      ]),
    );
    expect(writes).toEqual([{ photoId: "p3", tag: null }]);
    expect(writeRow(writes[0] as (typeof writes)[number])).toEqual({ photo_id: "p3", place: null });
  });

  it("keeps a binned card photo as a boundary: the photos after it stay with its child (security review 1)", () => {
    const OTHER = "c1000000-0000-4000-8000-000000000002";
    const CARD_B = "f1000000-0000-4000-8000-000000000002";
    const writes = planBatch(
      inputs([
        photo("p1", { qr_kind: "card", card_id: CARD, card_child_id: CHILD }),
        photo("p2"),
        photo("p3", { qr_kind: "card", card_id: CARD_B, card_child_id: OTHER, binned: true }),
        photo("p4"),
      ]),
    );
    expect(
      writes.map((w) => [w.photoId, w.tag?.place === "child" ? w.tag.childId : w.tag?.place]),
    ).toEqual([
      ["p1", "card"],
      ["p2", CHILD],
      ["p4", OTHER],
    ]);
  });

  it("applies what purged photos did before a photo (security review 1)", () => {
    expect(beforeStep(null)).toBeNull();
    expect(
      beforeStep({ card: true, card_id: CARD, card_child_id: CHILD, flag: "after_unreadable" }),
    ).toEqual({ card: { cardId: CARD, childId: CHILD }, flag: "afterUnreadable" });
    expect(
      beforeStep({ card: false, card_id: null, card_child_id: null, flag: "after_failed" }),
    ).toEqual({ card: null, flag: "afterFailed" });
    const writes = planBatch(
      inputs([
        photo("p1"),
        photo("p5", {
          before: { card: true, card_id: CARD, card_child_id: CHILD, flag: "after_failed" },
        }),
      ]),
    ).map(writeRow);
    expect(writes.map((w) => [w.photo_id, w.place, w.child_id, w.flag])).toEqual([
      ["p1", "leftovers", null, null],
      ["p5", "child", CHILD, "after_failed"],
    ]);
  });

  it("flags a photo without a QR result when others in the batch were read (security review 2)", () => {
    const writes = planBatch(
      inputs([
        photo("p1", { qr_kind: "card", card_id: CARD, card_child_id: CHILD }),
        photo("p2", { qr_kind: null }),
        photo("p3"),
      ]),
    ).map(writeRow);
    expect(writes.map((w) => w.flag)).toEqual([null, "unreadable_card", "after_unreadable"]);
  });

  it("puts a class-photo upload in the class's set", () => {
    const writes = planBatch(inputs([photo("p1")], { group_id: "g1" })).map(writeRow);
    expect(writes).toEqual([
      {
        photo_id: "p1",
        place: "class_set",
        child_id: null,
        group_id: "g1",
        card_id: null,
        flag: null,
      },
    ]);
  });

  it("maps move targets to ids only", () => {
    expect(targetRow({ kind: "child", childId: CHILD })).toEqual({ kind: "child", id: CHILD });
    expect(targetRow({ kind: "classSet", groupId: "g" })).toEqual({ kind: "class_set", id: "g" });
    expect(targetRow({ kind: "leftovers" })).toEqual({ kind: "leftovers" });
  });
});

describe("tagBatchNow", () => {
  const answer = (map: Record<string, (args: Record<string, unknown>) => unknown>) =>
    systemRpc.mockImplementation(
      async (_region: string, fn: string, args: Record<string, unknown>) => {
        const r = map[fn]?.(args);
        return r instanceof Error
          ? { data: null, error: { code: "P0001", message: r.message } }
          : { data: r ?? null, error: null };
      },
    );

  it("writes the batch's tags for the round it read", async () => {
    answer({ tagging_inputs: () => inputs([photo("p1")]), apply_batch_tags: () => 1 });
    expect(await tagBatchNow("ca", BATCH)).toBe("tagged");
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "apply_batch_tags", {
      p_batch_id: BATCH,
      p_round: 3,
      p_writes: [
        {
          photo_id: "p1",
          place: "leftovers",
          child_id: null,
          group_id: null,
          card_id: null,
          flag: null,
        },
      ],
    });
  });

  it("does nothing for a batch already tagged at its round, or one that is gone", async () => {
    answer({ tagging_inputs: () => inputs([photo("p1")], { tagged_round: 3 }) });
    expect(await tagBatchNow("ca", BATCH)).toBe("upToDate");
    answer({ tagging_inputs: () => null });
    expect(await tagBatchNow("ca", BATCH)).toBe("missing");
    expect(systemRpc).not.toHaveBeenCalledWith("ca", "apply_batch_tags", expect.anything());
  });

  it("waits for photos still processing; the sweep goes ahead only when all of them are stuck", async () => {
    answer({
      tagging_inputs: () => inputs([photo("p1")], { processing: 2, processing_stuck: 1 }),
      apply_batch_tags: () => 1,
    });
    expect(await tagBatchNow("ca", BATCH)).toBe("waiting");
    expect(await tagBatchNow("ca", BATCH, { force: true })).toBe("waiting");
    answer({
      tagging_inputs: () => inputs([photo("p1")], { processing: 2, processing_stuck: 2 }),
      apply_batch_tags: () => 1,
    });
    expect(await tagBatchNow("ca", BATCH)).toBe("waiting");
    expect(await tagBatchNow("ca", BATCH, { force: true })).toBe("tagged");
  });

  it("tries again when the round moved on, then leaves it to the sweep, logging the batch id only", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    answer({
      tagging_inputs: () => inputs([photo("p1")]),
      apply_batch_tags: () => new Error("tagging_stale"),
    });
    expect(await tagBatchNow("ca", BATCH)).toBe("stale");
    expect(systemRpc.mock.calls.filter(([, fn]) => fn === "apply_batch_tags").length).toBe(3);
    expect(errors).toHaveBeenCalledWith("tagging_stale", BATCH);
  });

  it("tags the batches of changed photos and never throws from after()", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    answer({
      batches_of_photos: () => [{ id: BATCH }],
      tagging_inputs: () => inputs([photo("p1")]),
      apply_batch_tags: () => 1,
    });
    await tagBatchesOfPhotos("ca", ["p1"]);
    expect(systemRpc).toHaveBeenCalledWith("ca", "batches_of_photos", { p_photo_ids: ["p1"] });
    systemRpc.mockRejectedValue(new TypeError("fetch failed for https://db.example/?key=secret"));
    await expect(tagBatchesOfPhotos("ca", ["p1"])).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith("tagging_failed", "TypeError");
  });
});

describe("toTaggedPhoto", () => {
  it("signs a preview for ready photos only and never carries a filename", async () => {
    const storage = { presignGet: vi.fn(async (key: string) => `https://s3.test/${key}`) };
    const ids = {
      studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
    };
    const row = {
      id: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
      status: "ready" as const,
      place: "blank_card",
      flag: "after_failed",
      card_id: BLANK,
      source: "auto" as const,
      qr_kind: "none",
      original_filename: "Maya Johnson.jpg",
    };
    const photo = await toTaggedPhoto(storage as never, ids, row);
    expect(photo).toEqual({
      id: row.id,
      status: "ready",
      place: "blankCard",
      flag: "afterFailed",
      childId: null,
      groupId: null,
      cardId: BLANK,
      manual: false,
      cardRead: false,
      qrKind: "none",
      actions: { move: true, confirm: true, markCard: true },
      thumbUrl: `https://s3.test/${ids.studioId}/${ids.jobId}/${row.id}/thumb.webp`,
    });
    expect(JSON.stringify(photo)).not.toContain("Maya");
    expect(
      (await toTaggedPhoto(storage as never, ids, { ...row, status: "processing" })).thumbUrl,
    ).toBeNull();
  });
});

describe("what review allows for a photo", () => {
  it("tells a removed card from another job's card", () => {
    expect(qrKindOf({ qr_kind: "card", qr_card: true })).toBe("card");
    expect(qrKindOf({ qr_kind: "card", qr_card: false })).toBe("removedCard");
    expect(qrKindOf({ qr_kind: "other_card" })).toBe("otherCard");
    expect(qrKindOf({ qr_kind: null })).toBeNull();
  });

  it("sends each photo's actions from core's rules (security review 3-4, code review M1)", async () => {
    const storage = { presignGet: vi.fn(async (key: string) => `https://s3.test/${key}`) };
    const ids = {
      studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
    };
    const base = {
      id: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
      status: "ready" as const,
      place: "child",
      child_id: CHILD,
      source: "auto" as const,
    };
    const actions = async (over: Record<string, unknown>) =>
      (
        await toTaggedPhoto(storage as never, ids, {
          ...base,
          qr_kind: "none",
          flag: null,
          ...over,
        })
      ).actions;
    expect(await actions({})).toEqual({ move: true, confirm: true, markCard: true });
    expect(await actions({ qr_kind: "unreadable", flag: "unreadable_card" })).toEqual({
      move: false,
      confirm: true,
      markCard: true,
    });
    expect(await actions({ qr_kind: "other_card", flag: "other_card" })).toEqual({
      move: false,
      confirm: false,
      markCard: true,
    });
    expect(await actions({ place: "card", source: "manual" })).toEqual({
      move: false,
      confirm: false,
      markCard: false,
    });
  });
});

describe("taggingError", () => {
  it("names each refusal for the screen, without values", () => {
    for (const [message, form] of [
      ["card_photo", "tagging.cardPhoto"],
      ["photo_not_ready", "tagging.photoNotReady"],
      ["card_claimed", "tagging.cardClaimed"],
      ["tagging_not_ready", "tagging.notReady"],
      ["confirm_first", "tagging.confirmFirst"],
      ["other_card", "tagging.otherCard"],
    ] as const) {
      const e = taggingError({ code: "P0001", message });
      expect([e.status, e.fields]).toEqual([409, { form }]);
    }
    expect(taggingError({ code: "42501" }).status).toBe(403);
    expect(taggingError({ code: "P0002" }).status).toBe(404);
    expect(taggingError({ code: "22023" }).status).toBe(400);
  });
});
