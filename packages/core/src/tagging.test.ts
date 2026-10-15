import { describe, expect, it } from "vitest";
import { compareTaggingOrder } from "./photos";
import {
  canMarkReviewed,
  classifyQr,
  composeSteps,
  isLegacyBatch,
  NO_STEP,
  notReviewableReason,
  type PhotoQr,
  planTagWrites,
  reviewActions,
  reviewTaggingDone,
  type StoredTag,
  type Tag,
  type TaggingFacts,
  type TaggingPhoto,
  type TagStep,
  tagBatch,
  tagCounts,
  tagStep,
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
// "X" a card from another job, "F" a failed photo, "P" a photo still processing, "o" a photo from an old worker. A "~"
// before a photo puts it in the bin.
const CARDS: Record<string, { cardId: string; childId: string | null }> = {
  A: { cardId: "card-a", childId: "child-a" },
  B: { cardId: "card-b", childId: "child-b" },
  K: { cardId: "card-k", childId: null },
};

function batch(spec: string): TaggingPhoto[] {
  const photos: TaggingPhoto[] = [];
  let binned = false;
  for (const c of spec) {
    if (c === "~") {
      binned = true;
      continue;
    }
    photos.push({ ...photo(c, photos.length + 1), ...(binned ? { binned } : {}) });
    binned = false;
  }
  return photos;
}

function photo(c: string, n: number): TaggingPhoto {
  {
    const id = `p${n}`;
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
  }
}

/** A readable summary of each photo's tag: "child-a", "leftovers!afterFailed", "card:card-a", "-" (untagged). */
function show(spec: string, groupPhotos = false): string[] {
  return tagBatch(batch(spec), { groupPhotos }).map(({ tag }) => {
    if (!tag) return "-";
    const where =
      tag.place === "child"
        ? tag.childId
        : tag.place === "groupPhoto"
          ? "group"
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

  it("treats a batch uploaded before cards were read (no photo read) as plain photos, in Leftovers", () => {
    expect(show("ooo")).toEqual(["leftovers", "leftovers", "leftovers"]);
    expect(show("oFo")).toEqual(["leftovers", "-", "leftovers!afterFailed"]);
  });

  it("flags a photo with no QR result in a batch where others were read (mixed workers; review 2)", () => {
    expect(show("ApoppBp")).toEqual([
      "card:card-a",
      "child-a",
      "child-a!unreadableCard",
      "child-a!afterUnreadable",
      "child-a!afterUnreadable",
      "card:card-b",
      "child-b",
    ]);
    expect(show("pop", true)).toEqual(["group", "group!unreadableCard", "group"]);
    expect(show("ooo", true)).toEqual(["group", "group", "group"]);
  });

  it("tags an empty batch as nothing", () => {
    expect(tagBatch([], { groupPhotos: false })).toEqual([]);
  });
});

describe("tagBatch: photos in the bin still mark where cards were (security review 1)", () => {
  it("binning a card photo never gives the next child's photos to the previous child", () => {
    // Without the binned card B, the photos after it would silently become child A's.
    expect(show("App~Bpp")).toEqual(["card:card-a", "child-a", "child-a", "child-b", "child-b"]);
  });

  it("binning a failed photo keeps the photos after it flagged", () => {
    expect(show("Ap~Fpp")).toEqual([
      "card:card-a",
      "child-a",
      "child-a!afterFailed",
      "child-a!afterFailed",
    ]);
  });

  it("binning an unreadable or another job's card keeps the photos after it flagged", () => {
    expect(show("Ap~?pBp")).toEqual([
      "card:card-a",
      "child-a",
      "child-a!afterUnreadable",
      "card:card-b",
      "child-b",
    ]);
    expect(show("Ap~Xp")).toEqual(["card:card-a", "child-a", "child-a!afterUnreadable"]);
    expect(show("Ap~op")).toEqual(["card:card-a", "child-a", "child-a!afterUnreadable"]);
  });

  it("gives binned photos no result, and binning a plain photo changes nothing else", () => {
    const tags = tagBatch(batch("A~pp"), { groupPhotos: false });
    expect(tags.map((t) => t.photoId)).toEqual(["p1", "p3"]);
    expect(show("A~pp")).toEqual(["card:card-a", "child-a"]);
  });

  it("counts a binned photo with a QR result when deciding whether a batch is from before cards were read", () => {
    expect(show("~Aoo")).toEqual(["child-a!unreadableCard", "child-a!unreadableCard"]);
  });

  it("ignores binned photos in class-photo uploads", () => {
    expect(show("p~Ap", true)).toEqual(["group", "group"]);
  });
});

describe("tagBatch: photos purged from the bin leave their step on the next photo (security review 1)", () => {
  const purged = (spec: string, n: number) => tagStep(photo(spec, n), false);
  const steps = (...specs: string[]) =>
    specs.reduce((acc, c, i) => composeSteps(acc, purged(c, i + 1)), NO_STEP);

  it("composes steps: the later card wins, a flag stays until a card clears it", () => {
    const a: TagStep = { card: { cardId: "card-a", childId: "child-a" }, flag: null };
    expect(steps("A", "F")).toEqual({ card: a.card, flag: "afterFailed" });
    expect(steps("F", "A")).toEqual(a);
    expect(steps("F", "p")).toEqual({ card: null, flag: "afterFailed" });
    expect(steps("F", "?")).toEqual({ card: null, flag: "afterUnreadable" });
    expect(steps("p", "p")).toEqual(NO_STEP);
    expect(steps("?", "B", "p")).toEqual({
      card: { cardId: "card-b", childId: "child-b" },
      flag: null,
    });
  });

  it("a purged card still sends the photos after it to its child", () => {
    const photos = batch("Appp");
    // Photos 5 (card B) and 6 were purged; photo 7 carries what they did.
    photos.push({ ...photo("p", 7), before: steps("B", "p") }, photo("p", 8));
    expect(tagBatch(photos, { groupPhotos: false }).map((r) => r.tag)).toEqual([
      { place: "card", cardId: "card-a", flag: null },
      { place: "child", childId: "child-a", flag: null },
      { place: "child", childId: "child-a", flag: null },
      { place: "child", childId: "child-a", flag: null },
      { place: "child", childId: "child-b", flag: null },
      { place: "child", childId: "child-b", flag: null },
    ]);
  });

  it("a purged failed photo still flags the photos after it", () => {
    const photos = [photo("A", 1), { ...photo("p", 3), before: steps("F") }];
    expect(tagBatch(photos, { groupPhotos: false }).map((r) => r.tag?.flag)).toEqual([
      null,
      "afterFailed",
    ]);
  });

  it("a purged card removed since flags the photos after it, until the next card (answer 13)", () => {
    const photos = [
      photo("A", 1),
      { ...photo("p", 3), before: { card: { cardId: null, childId: null }, flag: null } },
      photo("p", 4),
      photo("B", 5),
      photo("p", 6),
    ];
    expect(tagBatch(photos, { groupPhotos: false }).map((r) => r.tag)).toEqual([
      { place: "card", cardId: "card-a", flag: null },
      { place: "child", childId: "child-a", flag: "afterPurge" },
      { place: "child", childId: "child-a", flag: "afterPurge" },
      { place: "card", cardId: "card-b", flag: null },
      { place: "child", childId: "child-b", flag: null },
    ]);
  });

  it("applies before the photo itself, so a card right after a purged flag clears it", () => {
    const photos = [{ ...photo("A", 2), before: steps("?") }, photo("p", 3)];
    expect(tagBatch(photos, { groupPhotos: false }).map((r) => r.tag?.flag)).toEqual([null, null]);
  });

  it("knows a batch from before cards were read", () => {
    expect(isLegacyBatch(batch("ooFo"))).toBe(true);
    expect(isLegacyBatch(batch("oAo"))).toBe(false);
    expect(isLegacyBatch([])).toBe(true);
  });
});

describe("tagBatch: purge edge cases are flagged, never guessed (Seenu, answer 13)", () => {
  const purged = (spec: string, n: number) => tagStep(photo(spec, n), false);
  const late = (c: string, n: number): TaggingPhoto => ({ ...photo(c, n), afterPurge: true });
  const flags = (photos: TaggingPhoto[], purgeTail = false) =>
    tagBatch(photos, { groupPhotos: false, purgeTail }).map(({ tag }) =>
      tag
        ? `${tag.place === "child" ? tag.childId : tag.place}${tag.flag ? `!${tag.flag}` : ""}`
        : "-",
    );

  it("flags a photo that sorts after purged photos that were last in their batch", () => {
    // Photo 3 (card B) was purged with nothing after it; photo 4 arrived later.
    expect(flags([photo("A", 1), photo("p", 2), late("p", 4)], true)).toEqual([
      "card",
      "child-a",
      "child-a!afterPurge",
    ]);
  });

  it("leaves the batch alone when nothing came after a purge", () => {
    expect(flags([photo("A", 1), photo("p", 2)], true)).toEqual(["card", "child-a"]);
    // A late photo before the last photo that was there at the purge can't be after the purged ones.
    expect(flags([photo("A", 1), late("p", 2), photo("p", 3)], true)).toEqual([
      "card",
      "child-a",
      "child-a",
    ]);
  });

  it("flags a photo that appeared between the purged photos' neighbours", () => {
    // Photo 3 (card B) was purged; photo 4 carries it. Photo 2.5 appeared later: before or after card B?
    const photos = [
      photo("A", 1),
      photo("p", 2),
      { ...late("p", 25), id: "p2.5" },
      { ...photo("p", 4), before: purged("B", 3) },
      photo("p", 5),
    ];
    expect(flags(photos)).toEqual(["card", "child-a", "child-a!afterPurge", "child-b", "child-b"]);
  });

  it("flags from the purged step on when a late photo in the gap did something itself", () => {
    // A late card K may come before or after the purged card B: photo 4 on can't be placed either.
    const photos = [
      photo("A", 1),
      { ...late("K", 25), id: "p2.5" },
      { ...photo("p", 4), before: purged("B", 3) },
      photo("p", 5),
      photo("A", 6),
      photo("p", 7),
    ];
    expect(flags(photos)).toEqual([
      "card",
      "card",
      "child-b!afterPurge",
      "child-b!afterPurge",
      "card",
      "child-a",
    ]);
  });

  it("doesn't flag a late photo away from any purge", () => {
    const photos = [
      photo("A", 1),
      late("p", 2),
      photo("p", 3),
      { ...photo("p", 5), before: purged("B", 4) },
    ];
    expect(flags(photos)).toEqual(["card", "child-a", "child-a", "child-b"]);
  });

  it("flags every photo when the photo carrying a purged step has moved since", () => {
    const photos = [
      photo("A", 1),
      photo("p", 2),
      { ...late("p", 9), before: purged("B", 3) },
      photo("?", 4),
    ];
    expect(flags(photos)).toEqual([
      "card",
      "child-a!afterPurge",
      "child-b!afterPurge",
      "child-b!unreadableCard",
    ]);
  });
});

describe("tagBatch: class-photo uploads (answer 3)", () => {
  it("puts every photo in the class's set; cards are hidden and otherwise ignored (plan answer 8)", () => {
    expect(show("pApKp", true)).toEqual(["group", "card:card-a", "group", "card:card-k", "group"]);
  });

  it("flags only the unreadable photo itself, and leaves failed ones untagged", () => {
    expect(show("p?pFpX", true)).toEqual([
      "group",
      "group!unreadableCard",
      "group",
      "-",
      "group",
      "group!otherCard",
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
      { groupPhotos: false },
    );
    expect(tags.map((t) => [t.photoId, t.tag?.place])).toEqual([
      ["p1", "card"],
      ["p2", "child"],
      ["p3", "child"],
    ]);
  });
});

describe("planTagWrites: manual moves are never overwritten", () => {
  const computed = tagBatch(batch("App"), { groupPhotos: false });
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
    const failed = tagBatch(batch("AF"), { groupPhotos: false });
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
    const tags = tagBatch(batch("pK?pKpA"), { groupPhotos: false }).map((r) => r.tag);
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

describe("reviewActions (security review 3-4, code review M1)", () => {
  const ready = {
    status: "ready" as const,
    place: "child" as const,
    flag: null,
    qrKind: "none" as const,
    manual: false,
  };
  const all = { move: true, confirm: true, markCard: true, undoCard: false };
  const none = { move: false, confirm: false, markCard: false, undoCard: false };

  it("lets a plain photo be moved, confirmed or marked a card photo", () => {
    expect(reviewActions(ready)).toEqual(all);
    expect(reviewActions({ ...ready, flag: "afterUnreadable" })).toEqual(all);
    expect(reviewActions({ ...ready, qrKind: null, place: "leftovers" })).toEqual(all);
  });

  it("never moves or confirms a card photo, read or marked by a person", () => {
    expect(reviewActions({ ...ready, place: "card", qrKind: "card" })).toEqual(none);
    expect(reviewActions({ ...ready, place: "card", qrKind: "unreadable" })).toEqual(none);
  });

  it("lets a photo a person marked a card photo be unmarked, never one whose card was read (answer 12)", () => {
    const undo = { ...none, undoCard: true };
    expect(reviewActions({ ...ready, place: "card", qrKind: "unreadable", manual: true })).toEqual(
      undo,
    );
    expect(reviewActions({ ...ready, place: "card", qrKind: "otherCard", manual: true })).toEqual(
      undo,
    );
    expect(reviewActions({ ...ready, place: "card", qrKind: "card", manual: true })).toEqual(none);
    expect(
      reviewActions({ ...ready, place: "card", qrKind: "none", manual: true, status: "failed" }),
    ).toEqual(none);
    // Once undone it is flagged again: confirmed (either way) before it moves.
    expect(
      reviewActions({ ...ready, qrKind: "none", flag: "unreadableCard", manual: true }),
    ).toEqual({ ...none, confirm: true, markCard: true });
  });

  it("never gives a group photo to a person (D156, C8): it is confirmed or marked a card photo", () => {
    const keepOrCard = { move: false, confirm: true, markCard: true, undoCard: false };
    expect(reviewActions({ ...ready, place: "groupPhoto" })).toEqual(keepOrCard);
    expect(reviewActions({ ...ready, place: "groupPhoto", flag: "unreadableCard" })).toEqual(
      keepOrCard,
    );
  });

  it("treats a photo flagged near a purge like any flagged photo", () => {
    expect(reviewActions({ ...ready, flag: "afterPurge" })).toEqual(all);
  });

  it("only lets another job's card (or a removed card) be marked a card photo", () => {
    const cardOnly = { move: false, confirm: false, markCard: true, undoCard: false };
    expect(reviewActions({ ...ready, qrKind: "otherCard", flag: "otherCard" })).toEqual(cardOnly);
    // Even after its flag is gone (its child was removed and it went to Leftovers).
    expect(reviewActions({ ...ready, qrKind: "otherCard", place: "leftovers" })).toEqual(cardOnly);
    expect(reviewActions({ ...ready, qrKind: "removedCard", flag: "otherCard" })).toEqual(cardOnly);
  });

  it("asks for a photo that may be a card to be confirmed before it moves", () => {
    expect(reviewActions({ ...ready, qrKind: "unreadable", flag: "unreadableCard" })).toEqual({
      move: false,
      confirm: true,
      markCard: true,
      undoCard: false,
    });
    // Once confirmed as a normal photo, it moves like any other.
    expect(reviewActions({ ...ready, qrKind: "unreadable" })).toEqual(all);
  });

  it("has nothing to do with photos that failed or are processing", () => {
    expect(reviewActions({ ...ready, status: "failed" })).toEqual(none);
    expect(reviewActions({ ...ready, status: "processing" })).toEqual(none);
  });
});
