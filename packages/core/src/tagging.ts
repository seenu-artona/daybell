/**
 * QR tagging (Phase 1 step 5; D32, F16, D142 #7, D143; ADR 0018). Daybell reads the QR card in each uploaded photo and
 * gives each child every photo up to the next card. Pure rules shared by the image worker (what a photo's QR results
 * mean), the API (which photo goes where, what to write) and the screens (when review is done).
 *
 * Seenu's answers (Oct 12, 2026) shape every rule here:
 * - a card shot twice in a row is ignored; photos before the first card go to Leftovers (Phase 1 spec);
 * - a photo that looks like a card but can't be read, or a card from another job, is hidden from parents and flagged,
 *   and the photos after it stay with the previous child but are flagged too, never silently mis-tagged (1, plan 1-2);
 * - a photo that failed (or isn't processed yet) flags the photos after it (plan 3);
 * - a card that reappears later (a retake) sends the photos after it back to that child (plan 8);
 * - class-photo uploads go to the class's set, and cards in them are hidden and otherwise ignored (3, plan 8);
 * - each upload batch is tagged on its own, starting in Leftovers;
 * - manual moves are never overwritten when a batch is tagged again.
 */
import { parseCardQrPayload } from "./qr-cards";

// ── What a photo's QR results mean (the image worker) ─────────────────────────────────────────────────────────────

/** One symbol the decoder found: `valid` when it decoded, else it was located (finder patterns) but couldn't be read. */
export interface QrSymbol {
  valid: boolean;
  /** The decoded text; meaningless when not valid. Never logged. */
  text: string;
}

/**
 * What the worker reports about a photo's QR codes. `card` holds the card code (never logged, never queued: it travels
 * only in the signed result). `unreadable`: something that looks like a QR card is in the photo but couldn't be read
 * for sure.
 */
export type QrReading =
  | { kind: "none" }
  | { kind: "card"; cardCode: string }
  | { kind: "unreadable" };

/**
 * Classifies a photo's QR symbols:
 * - other QR codes (not Daybell cards) are ignored;
 * - one Daybell card, read cleanly, is a card (the same card twice in one frame too);
 * - a symbol located but not decoded, a "DBC1:" payload with a bad code, or two different cards in one frame are
 *   unreadable. A clean card next to a symbol that couldn't be read is unreadable too: it might be a second card, and
 *   guessing would risk giving a child's photos to the wrong child.
 */
export function classifyQr(symbols: readonly QrSymbol[]): QrReading {
  const codes = new Set<string>();
  let doubtful = false;
  for (const symbol of symbols) {
    if (!symbol.valid) {
      doubtful = true;
      continue;
    }
    const code = parseCardQrPayload(symbol.text);
    if (code) codes.add(code);
    else if (symbol.text.trim().startsWith("DBC1:")) doubtful = true;
  }
  if (codes.size > 1 || doubtful) return { kind: "unreadable" };
  const [code] = codes;
  return code ? { kind: "card", cardCode: code } : { kind: "none" };
}

// ── Tagging one upload batch ──────────────────────────────────────────────────────────────────────────────────────

/** Where a photo is: a child, a class's "Class photo" set, Leftovers, a card photo, or waiting for a blank card's child. */
export const PHOTO_PLACES = ["child", "classSet", "leftovers", "card", "blankCard"] as const;
export type PhotoPlace = (typeof PHOTO_PLACES)[number];

/**
 * Why a photo needs checking. Flagged photos are hidden from parents until someone confirms them at review.
 * - unreadableCard: looks like a QR card but couldn't be read;
 * - otherCard: a Daybell card that isn't one of this job's;
 * - afterUnreadable: after one of those, so it may belong to someone else;
 * - afterFailed: after a photo that couldn't be processed (it may have been a card).
 */
export const PHOTO_FLAGS = [
  "unreadableCard",
  "otherCard",
  "afterUnreadable",
  "afterFailed",
] as const;
export type PhotoFlag = (typeof PHOTO_FLAGS)[number];

/** A photo's place, with the id that goes with it. */
export type TagTarget =
  | { place: "child"; childId: string }
  | { place: "classSet"; groupId: string }
  | { place: "leftovers" }
  | { place: "card"; cardId: string | null }
  | { place: "blankCard"; cardId: string };

export type Tag = TagTarget & { flag: PhotoFlag | null };

/** What tagging knows about a photo's QR card, from the database (the card resolved within the photo's own job). */
export type PhotoQr =
  /** Not processed by a worker that reads cards: treated as a plain photo. */
  | null
  | { kind: "none" }
  | { kind: "unreadable" }
  /** A Daybell card that isn't one of this job's (another job, another studio, or a card since deleted). */
  | { kind: "otherCard" }
  /** One of the job's cards: a child's (childId) or a blank card (childId null). */
  | { kind: "card"; cardId: string; childId: string | null };

export interface TaggingPhoto {
  id: string;
  status: "uploading" | "processing" | "ready" | "failed";
  qr: PhotoQr;
}

export interface TaggingResult {
  photoId: string;
  /** Null: the photo isn't tagged (it failed, or isn't processed yet). */
  tag: Tag | null;
}

/**
 * Tags one upload batch. `photos` must be in tagging order (compareTaggingOrder: capture time, then filename; D142 #7)
 * and exclude photos in the bin. With `classGroupId` the batch is a class-photo upload (Seenu, answer 3).
 *
 * In a batch of individual photos the target starts at Leftovers. A readable card makes its own photo a card photo and
 * sends the photos after it to the card's child (or, for a blank card, to that card until the studio names the
 * child). The same card again changes nothing, so a card shot twice in a row is ignored, and a card seen again later
 * (a retake) sends photos back to its child. A card that can't be read, or isn't this job's, stays with the current
 * target, flagged and hidden; the photos after it keep that target, flagged, until the next readable card. A photo that
 * failed or isn't processed yet gets no tag, and flags the photos after it.
 */
export function tagBatch(
  photos: readonly TaggingPhoto[],
  options: { classGroupId: string | null },
): TaggingResult[] {
  if (options.classGroupId) {
    const groupId = options.classGroupId;
    return photos.map((photo) => {
      if (photo.status !== "ready") return { photoId: photo.id, tag: null };
      const qr = photo.qr;
      // Cards inside class photos are hidden and otherwise ignored (Seenu, plan answer 8).
      if (qr?.kind === "card")
        return { photoId: photo.id, tag: { place: "card", cardId: qr.cardId, flag: null } };
      const flag: PhotoFlag | null =
        qr?.kind === "unreadable"
          ? "unreadableCard"
          : qr?.kind === "otherCard"
            ? "otherCard"
            : null;
      return { photoId: photo.id, tag: { place: "classSet", groupId, flag } };
    });
  }

  let target: TagTarget = { place: "leftovers" };
  let carried: PhotoFlag | null = null;
  return photos.map((photo): TaggingResult => {
    if (photo.status !== "ready") {
      carried = "afterFailed";
      return { photoId: photo.id, tag: null };
    }
    const qr = photo.qr;
    if (qr?.kind === "card") {
      target = qr.childId
        ? { place: "child", childId: qr.childId }
        : { place: "blankCard", cardId: qr.cardId };
      carried = null;
      return { photoId: photo.id, tag: { place: "card", cardId: qr.cardId, flag: null } };
    }
    if (qr?.kind === "unreadable" || qr?.kind === "otherCard") {
      carried = "afterUnreadable";
      return {
        photoId: photo.id,
        tag: { ...target, flag: qr.kind === "unreadable" ? "unreadableCard" : "otherCard" },
      };
    }
    return { photoId: photo.id, tag: { ...target, flag: carried } };
  });
}

// ── Writing tags ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A photo's tag as stored. Manual tags (moves and confirmations at review) are never overwritten by tagging. */
export type StoredTag = Tag & { source: "auto" | "manual" };

/** One write: set a photo's automatic tag, or (tag null) remove it. */
export interface TagWrite {
  photoId: string;
  tag: Tag | null;
}

const idOf = (t: TagTarget): string | null =>
  t.place === "child"
    ? t.childId
    : t.place === "classSet"
      ? t.groupId
      : t.place === "card" || t.place === "blankCard"
        ? t.cardId
        : null;

export function sameTag(a: Tag | null, b: Tag | null): boolean {
  if (a === null || b === null) return a === b;
  return a.place === b.place && idOf(a) === idOf(b) && a.flag === b.flag;
}

/**
 * Only the automatic tags that change: photos tagged by hand are skipped, and a photo whose tag is already right is
 * left alone, so tagging the same batch twice writes nothing the second time.
 */
export function planTagWrites(
  current: ReadonlyMap<string, StoredTag>,
  computed: readonly TaggingResult[],
): TagWrite[] {
  const writes: TagWrite[] = [];
  for (const { photoId, tag } of computed) {
    const stored = current.get(photoId);
    if (stored?.source === "manual") continue;
    if (stored === undefined ? tag === null : sameTag(stored, tag)) continue;
    writes.push({ photoId, tag });
  }
  return writes;
}

/** Counts for the photos.tagged event and the review screen: ids and counts only (D96). */
export function tagCounts(tags: readonly (Tag | null)[]): {
  cards: number;
  leftovers: number;
  flagged: number;
  blankCards: number;
} {
  const blank = new Set<string>();
  let cards = 0;
  let leftovers = 0;
  let flagged = 0;
  for (const tag of tags) {
    if (!tag) continue;
    if (tag.place === "card") cards++;
    if (tag.place === "leftovers") leftovers++;
    if (tag.place === "blankCard") blank.add(tag.cardId);
    if (tag.flag) flagged++;
  }
  return { cards, leftovers, flagged, blankCards: blank.size };
}

// ── Review (D143's "Review tagging") ──────────────────────────────────────────────────────────────────────────────

export interface TaggingFacts {
  /** The job has a ready photo not in the bin. */
  hasReadyPhoto: boolean;
  /** Photos are still uploading or processing, or a batch hasn't been tagged since it changed. */
  taggingPending: boolean;
  /** Photos in Leftovers (not in the bin). */
  leftovers: number;
  /** Photos flagged for checking (not in the bin). */
  flagged: number;
  /** Blank cards whose photos are waiting for the studio to name the child. */
  blankCardsPending: number;
  /** Someone clicked Mark reviewed, and no photo has arrived since (nor a change to Leftovers or a flag). */
  taggingReviewed: boolean;
}

/**
 * Mark reviewed is enabled only when tagging is clean (Seenu, plan answer 4): every photo processed and tagged, no
 * Leftovers, no flags, no blank cards still to name. A job with no photos has nothing to review.
 */
export function canMarkReviewed(f: TaggingFacts): boolean {
  return (
    f.hasReadyPhoto &&
    !f.taggingPending &&
    f.leftovers === 0 &&
    f.flagged === 0 &&
    f.blankCardsPending === 0
  );
}

/**
 * The checklist's Review tagging task and the Selling gate (Seenu, answer 4 and plan answer 7): clean, and marked
 * reviewed. A job with no photos fails it. It reopens when new photos arrive or tags change to Leftovers or flags
 * (the database clears the review); moving photos between children after review doesn't (plan answer 5).
 */
export function reviewTaggingDone(f: TaggingFacts): boolean {
  return canMarkReviewed(f) && f.taggingReviewed;
}

/** Why Mark reviewed is disabled, first reason first; null when it is enabled. Screens say it in words. */
export type NotReviewableReason = "noPhotos" | "pending" | "leftovers" | "flagged" | "blankCards";

export function notReviewableReason(f: TaggingFacts): NotReviewableReason | null {
  if (!f.hasReadyPhoto) return "noPhotos";
  if (f.taggingPending) return "pending";
  if (f.leftovers > 0) return "leftovers";
  if (f.flagged > 0) return "flagged";
  if (f.blankCardsPending > 0) return "blankCards";
  return null;
}

/** Photos moved or confirmed per request. */
export const MAX_PHOTOS_PER_MOVE = 500;
/** Photos in each child's strip on the review screen before "Show all". */
export const REVIEW_STRIP_PHOTOS = 12;
/** Children per page of an album on the review screen. */
export const REVIEW_CHILDREN_PAGE = 100;
