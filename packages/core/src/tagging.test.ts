import { describe, expect, it } from "vitest";
import { compareTaggingOrder } from "./photos";
import {
  canMarkReviewed,
  classifyQr,
  notReviewableReason,
  type PhotoQr,
  planTagWrites,
  reviewTaggingDone,
  type StoredTag,
  type Tag,
  type TaggingFacts,
  type TaggingPhoto,
  tagBatch,
  tagCounts,
} from "./tagging";

const CODE_A = "0123456789ABCDEFGHJK";
const CODE_B = "MNPQRSTVWXYZ01234567";

describe("classifyQr (what the worker reports)", () => {
  const ok = (text: string) => ({ valid: true, text });
  const bad = (text = "") => ({ valid: false, text });

  it("reads one Daybell card", () => {
    expect(classifyQr([ok(`DBC1:${CODE_A}`)])).toEqual({ kind: "card", cardCode: CODE_A });
  });

  it("reads the same card twice in one frame as that card", () => {
    expect(classifyQr([ok(`DBC1:${CODE_A}`), ok(` DBC1:${CODE_A} `)])).toEqual({
      kind: "card",
      cardCode: CODE_A,
    });
  });

  it("ignores QR codes that aren't Daybell cards", () => {
    expect(classifyQr([])).toEqual({ kind: "none" });
    expect(classifyQr([ok("https://example.com/menu")])).toEqual({ kind: "none" });
    expect(classifyQr([ok("https://example.com"), ok(`DBC1:${CODE_A}`)])).toEqual({
      kind: "card",
      cardCode: CODE_A,
    });
  });

  it("calls a symbol located but not decoded unreadable (Seenu, answer 1)", () => {
    expect(classifyQr([bad()])).toEqual({ kind: "unreadable" });
    // Partial text from a failed decode is never trusted.
    expect(classifyQr([bad(`DBC1:${CODE_A}`)])).toEqual({ kind: "unreadable" });
  });

  it("calls a DBC1 payload with a bad code unreadable, never a card", () => {
    expect(classifyQr([ok("DBC1:0123456789ABCDEFGHJI")])).toEqual({ kind: "unreadable" });
    expect(classifyQr([ok("DBC1:SHORT")])).toEqual({ kind: "unreadable" });
  });

  it("calls two different cards in one frame unreadable, so nobody gets the wrong photos", () => {
    expect(classifyQr([ok(`DBC1:${CODE_A}`), ok(`DBC1:${CODE_B}`)])).toEqual({
      kind: "unreadable",
    });
  });

  it("calls a clean card next to a symbol that couldn't be read unreadable (it may be a second card)", () => {
    expect(classifyQr([ok(`DBC1:${CODE_A}`), bad()])).toEqual({ kind: "unreadable" });
  });
});

// A compact way to write a batch: "p" a plain photo, "A"/"B" a child's card, "K" a blank card, "?" an unreadable card,
// "X" a card from another job, "F" a failed photo, "P" a photo still processing, "o" a photo from an old worker.
const CARDS: Record<string, { cardId: string; childId: string | null }> = {
  A: { cardId: "card-a", childId: "child-a" },
  B: { cardId: "card-b", childId: "child-b" },
  K: { cardId: "card-k", childId: null },
};

function batch(spec: string): TaggingPhoto[] {
  return [...spec].map((c, i) => {
    const id = `p${i + 1}`;
    const card = CARDS[c];
    const qr: PhotoQr = card
      ? { kind: "card", ...card }
      : c === "?"
        ? { kind: "unreadable" }
        : c === "X"
          ? { kind: "otherCard" }
          : c === "o"
            ? null
            : { kind: "none" };
    const status = c === "F" ? "failed" : c === "P" ? "processing" : "ready";
    return { id, status, qr: status === "ready" ? qr : null };
  });
}

/** A readable summary of each photo's tag: "child-a", "leftovers!afterFailed", "card:card-a", "-" (untagged). */
function show(spec: string, classGroupId: string | null = null): string[] {
  return tagBatch(batch(spec), { classGroupId }).map(({ tag }) => {
    if (!tag) return "-";
    const where =
      tag.place === "child"
        ? tag.childId
        : tag.place === "classSet"
          ? `class:${tag.groupId}`
          : tag.place === "card"
            ? `card:${tag.cardId}`
            : tag.place === "blankCard"
              ? `blank:${tag.cardId}`
              : "leftovers";
    return tag.flag ? `${where}!${tag.flag}` : where;
  });
}

describe("tagBatch: the sequence rules (D32, F16)", () => {
  it("gives each child every photo up to the next card; card photos are card photos", () => {
    expect(show("ApppBpp")).toEqual([
      "card:card-a",
      "child-a",
      "child-a",
      "child-a",
      "card:card-b",
      "child-b",
      "child-b",
    ]);
  });

  it("sends photos before the first card to Leftovers", () => {
    expect(show("ppAp")).toEqual(["leftovers", "leftovers", "card:card-a", "child-a"]);
    expect(show("ppp")).toEqual(["leftovers", "leftovers", "leftovers"]);
  });

  it("ignores a card shot twice in a row", () => {
    expect(show("AApp")).toEqual(["card:card-a", "card:card-a", "child-a", "child-a"]);
  });

  it("sends photos after a retake card back to that child (plan answer 8)", () => {
    expect(show("ApBpAp")).toEqual([
      "card:card-a",
      "child-a",
      "card:card-b",
      "child-b",
      "card:card-a",
      "child-a",
    ]);
  });

  it("holds a blank card's photos for the child the studio will name (answer 2)", () => {
    expect(show("Kpp")).toEqual(["card:card-k", "blank:card-k", "blank:card-k"]);
  });

  it("flags an unreadable card and the photos after it, keeping the previous child (answer 1)", () => {
    expect(show("Ap?ppBp")).toEqual([
      "card:card-a",
      "child-a",
      "child-a!unreadableCard",
      "child-a!afterUnreadable",
      "child-a!afterUnreadable",
      "card:card-b",
      "child-b",
    ]);
  });

  it("flags an unreadable card before any card, in Leftovers", () => {
    expect(show("?pA")).toEqual([
      "leftovers!unreadableCard",
      "leftovers!afterUnreadable",
      "card:card-a",
    ]);
  });

  it("treats a card from another job like an unreadable card (plan answer 2)", () => {
    expect(show("ApXpBp")).toEqual([
      "card:card-a",
      "child-a",
      "child-a!otherCard",
      "child-a!afterUnreadable",
      "card:card-b",
      "child-b",
    ]);
  });

  it("flags the photos after a failed photo, which itself gets no tag (plan answer 3)", () => {
    expect(show("ApFppBp")).toEqual([
      "card:card-a",
      "child-a",
      "-",
      "child-a!afterFailed",
      "child-a!afterFailed",
      "card:card-b",
      "child-b",
    ]);
  });

  it("treats a photo still processing like a failed one (a forced run)", () => {
    expect(show("ApPp")).toEqual(["card:card-a", "child-a", "-", "child-a!afterFailed"]);
  });

  it("clears the flag at the next readable card, even the same card again", () => {
    expect(show("A?pAp")).toEqual([
      "card:card-a",
      "child-a!unreadableCard",
      "child-a!afterUnreadable",
      "card:card-a",
      "child-a",
    ]);
  });

  it("treats photos processed before cards were read (an older worker) as plain photos", () => {
    expect(show("Aoo")).toEqual(["card:card-a", "child-a", "child-a"]);
  });

  it("tags an empty batch as nothing", () => {
    expect(tagBatch([], { classGroupId: null })).toEqual([]);
  });
});

describe("tagBatch: class-photo uploads (answer 3)", () => {
  it("puts every photo in the class's set; cards are hidden and otherwise ignored (plan answer 8)", () => {
    expect(show("pApKp", "g1")).toEqual([
      "class:g1",
      "card:card-a",
      "class:g1",
      "card:card-k",
      "class:g1",
    ]);
  });

  it("flags only the unreadable photo itself, and leaves failed ones untagged", () => {
    expect(show("p?pFpX", "g1")).toEqual([
      "class:g1",
      "class:g1!unreadableCard",
      "class:g1",
      "-",
      "class:g1",
      "class:g1!otherCard",
    ]);
  });
});

describe("tagging order (D142 #7)", () => {
  it("tags in capture time, then filename order, untimed photos last", () => {
    const rows = [
      { id: "p3", batchSeq: 1, capturedAt: null, originalFilename: "a.jpg" },
      { id: "p2", batchSeq: 1, capturedAt: "2026-10-01T09:00:02", originalFilename: "z.jpg" },
      { id: "p1", batchSeq: 1, capturedAt: "2026-10-01T09:00:01", originalFilename: "card.jpg" },
    ].sort(compareTaggingOrder);
    const qr: Record<string, PhotoQr> = {
      p1: { kind: "card", cardId: "card-a", childId: "child-a" },
      p2: { kind: "none" },
      p3: { kind: "none" },
    };
    const tags = tagBatch(
      rows.map((r) => ({ id: r.id, status: "ready", qr: qr[r.id] ?? null })),
      { classGroupId: null },
    );
    expect(tags.map((t) => [t.photoId, t.tag?.place])).toEqual([
      ["p1", "card"],
      ["p2", "child"],
      ["p3", "child"],
    ]);
  });
});

describe("planTagWrites: manual moves are never overwritten", () => {
  const computed = tagBatch(batch("App"), { classGroupId: null });
  const stored = (tags: [string, StoredTag][]) => new Map(tags);
  const childA: Tag = { place: "child", childId: "child-a", flag: null };

  it("writes every tag the first time, and nothing when applied again (idempotent)", () => {
    const first = planTagWrites(new Map(), computed);
    expect(first.map((w) => w.photoId)).toEqual(["p1", "p2", "p3"]);
    const after = stored(
      first.map((w) => [w.photoId, { ...(w.tag as Tag), source: "auto" }] as [string, StoredTag]),
    );
    expect(planTagWrites(after, computed)).toEqual([]);
  });

  it("skips photos moved by hand, even when tagging would put them elsewhere", () => {
    const current = stored([
      ["p1", { place: "card", cardId: "card-a", flag: null, source: "auto" }],
      ["p2", { place: "child", childId: "child-b", flag: null, source: "manual" }],
      ["p3", { place: "leftovers", flag: null, source: "manual" }],
    ]);
    expect(planTagWrites(current, computed)).toEqual([]);
  });

  it("changes an automatic tag that is now wrong (a card read on retry), and only that one", () => {
    const current = stored([
      ["p1", { place: "leftovers", flag: null, source: "auto" }],
      ["p2", { place: "leftovers", flag: null, source: "auto" }],
      ["p3", { ...childA, source: "auto" }],
    ]);
    expect(planTagWrites(current, computed)).toEqual([
      { photoId: "p1", tag: { place: "card", cardId: "card-a", flag: null } },
      { photoId: "p2", tag: childA },
    ]);
  });

  it("removes an automatic tag from a photo that can't be tagged any more, but never a manual one", () => {
    const failed = tagBatch(batch("AF"), { classGroupId: null });
    expect(
      planTagWrites(
        stored([["p2", { ...childA, source: "auto" }]]),
        failed.filter((r) => r.photoId === "p2"),
      ),
    ).toEqual([{ photoId: "p2", tag: null }]);
    expect(
      planTagWrites(
        stored([["p2", { ...childA, source: "manual" }]]),
        failed.filter((r) => r.photoId === "p2"),
      ),
    ).toEqual([]);
    expect(
      planTagWrites(
        new Map(),
        failed.filter((r) => r.photoId === "p2"),
      ),
    ).toEqual([]);
  });

  it("notices a changed flag on the same place", () => {
    const current = stored([["p2", { ...childA, flag: "afterFailed", source: "auto" }]]);
    expect(
      planTagWrites(
        current,
        computed.filter((r) => r.photoId === "p2"),
      ),
    ).toEqual([{ photoId: "p2", tag: childA }]);
  });
});

describe("tagCounts", () => {
  it("counts cards, Leftovers, flags and blank cards (distinct)", () => {
    const tags = tagBatch(batch("pK?pKpA"), { classGroupId: null }).map((r) => r.tag);
    expect(tagCounts([...tags, null])).toEqual({
      cards: 3,
      leftovers: 1,
      flagged: 2,
      blankCards: 1,
    });
  });
});

describe("review (D143; answer 4, plan answers 4, 5, 7)", () => {
  const clean: TaggingFacts = {
    hasReadyPhoto: true,
    taggingPending: false,
    leftovers: 0,
    flagged: 0,
    blankCardsPending: 0,
    taggingReviewed: false,
  };

  it("enables Mark reviewed only when clean, and is done only once marked", () => {
    expect(canMarkReviewed(clean)).toBe(true);
    expect(reviewTaggingDone(clean)).toBe(false);
    expect(reviewTaggingDone({ ...clean, taggingReviewed: true })).toBe(true);
  });

  it("is not done with leftovers, flags, unnamed blank cards or photos still being tagged", () => {
    for (const over of [
      { leftovers: 1 },
      { flagged: 2 },
      { blankCardsPending: 1 },
      { taggingPending: true },
    ]) {
      expect(canMarkReviewed({ ...clean, ...over })).toBe(false);
      expect(reviewTaggingDone({ ...clean, ...over, taggingReviewed: true })).toBe(false);
    }
  });

  it("fails a job with no photos (plan answer 7)", () => {
    expect(reviewTaggingDone({ ...clean, hasReadyPhoto: false, taggingReviewed: true })).toBe(
      false,
    );
    expect(notReviewableReason({ ...clean, hasReadyPhoto: false })).toBe("noPhotos");
  });

  it("says why, first reason first", () => {
    expect(notReviewableReason(clean)).toBeNull();
    expect(notReviewableReason({ ...clean, taggingPending: true, leftovers: 3 })).toBe("pending");
    expect(notReviewableReason({ ...clean, leftovers: 3, flagged: 1 })).toBe("leftovers");
    expect(notReviewableReason({ ...clean, flagged: 1, blankCardsPending: 1 })).toBe("flagged");
    expect(notReviewableReason({ ...clean, blankCardsPending: 1 })).toBe("blankCards");
  });
});
