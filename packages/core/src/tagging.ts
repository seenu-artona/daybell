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
 * - group-photo uploads are group photos, and cards in them are hidden and otherwise ignored (3, plan 8; D156: class
 *   photo sets became group photos, ADR 0030);
 * - each upload batch is tagged on its own, starting in Leftovers;
 * - manual moves are never overwritten when a batch is tagged again;
 * - where photos purged from the bin were can't always be known (the purged photos were last, a photo came or moved into
 *   the batch's order after a purge, or a purged card was removed since): the photos that could be affected are
 *   flagged, never guessed (13).
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

/**
 * Where a photo is: a child, a group photo (shown through the groups it is linked to, never placed by tagging with a
 * group: ADR 0030), Leftovers, a card photo, or waiting for a blank card's child.
 */
export const PHOTO_PLACES = ["child", "groupPhoto", "leftovers", "card", "blankCard"] as const;
export type PhotoPlace = (typeof PHOTO_PLACES)[number];

/**
 * Why a photo needs checking. Flagged photos are hidden from parents until someone confirms them at review.
 * - unreadableCard: looks like a QR card but couldn't be read;
 * - otherCard: a Daybell card that isn't one of this job's;
 * - afterUnreadable: after one of those, so it may belong to someone else;
 * - afterFailed: after a photo that couldn't be processed (it may have been a card);
 * - afterPurge: near photos purged from the bin, where what they did can't be placed for sure (Seenu, answer 13).
 */
export const PHOTO_FLAGS = [
  "unreadableCard",
  "otherCard",
  "afterUnreadable",
  "afterFailed",
  "afterPurge",
] as const;
export type PhotoFlag = (typeof PHOTO_FLAGS)[number];

/** A photo's place, with the id that goes with it. */
export type TagTarget =
  | { place: "child"; childId: string }
  | { place: "groupPhoto" }
  | { place: "leftovers" }
  | { place: "card"; cardId: string | null }
  | { place: "blankCard"; cardId: string };

export type Tag = TagTarget & { flag: PhotoFlag | null };

/** What tagging knows about a photo's QR card, from the database (the card resolved within the photo's own job). */
export type PhotoQr =
  /**
   * Not processed by a worker that reads cards. In a batch where some photo was read, it may have been a card, so it
   * counts as unreadable; in a batch where none was (uploaded before cards were read), as a plain photo (review 2).
   */
  | null
  | { kind: "none" }
  | { kind: "unreadable" }
  /** A Daybell card that isn't one of this job's (another job, another studio, or a card since deleted). */
  | { kind: "otherCard" }
  /** One of the job's cards: a child's (childId) or a blank card (childId null). */
  | { kind: "card"; cardId: string; childId: string | null };

/**
 * What a photo does to the photos after it: a card sends them to its child (a card since deleted is null: it counts as
 * another job's card), and a flag marks them for checking until the next card. Photos purged from the bin leave theirs
 * on the next photo (TaggingPhoto.before), so purging a card photo never moves anyone's photos (security review 1).
 */
export interface TagStep {
  card: { cardId: string | null; childId: string | null } | null;
  flag: "afterUnreadable" | "afterFailed" | null;
}

/** A step that changes nothing: a plain photo. */
export const NO_STEP: TagStep = { card: null, flag: null };

/** One step, then another: the later card wins, and a flag stays until a card clears it. */
export function composeSteps(a: TagStep, b: TagStep): TagStep {
  if (b.card) return { card: b.card, flag: b.flag };
  return { card: a.card, flag: b.flag ?? a.flag };
}

export interface TaggingPhoto {
  id: string;
  status: "uploading" | "processing" | "ready" | "failed";
  qr: PhotoQr;
  /**
   * In the bin: the photo gets no tag, but still does what it did to the photos after it (a card is still where it
   * was), so binning a card photo never gives the next child's photos to the previous child (security review 1).
   */
  binned?: boolean;
  /** What photos purged from the bin just before this one did (see TagStep). */
  before?: TagStep | null;
  /**
   * It came into the batch's order, or moved in it, after a purge left a step in the batch: where the purged photos
   * were relative to it is unknown (Seenu, answer 13).
   */
  afterPurge?: boolean;
}

export interface TaggingResult {
  photoId: string;
  /** Null: the photo isn't tagged (it failed, or isn't processed yet). */
  tag: Tag | null;
}

/** A batch uploaded before cards were read: no ready photo has a QR result, so null means "no card". */
export function isLegacyBatch(photos: readonly TaggingPhoto[]): boolean {
  return photos.every((p) => p.status !== "ready" || p.qr === null);
}

/** What one photo is, for tagging: a card, something that may be a card (flagged), or a plain photo. */
type PhotoKind =
  | { kind: "card"; cardId: string; childId: string | null }
  | { kind: "doubt"; flag: "unreadableCard" | "otherCard" }
  | { kind: "plain" };

function kindOf(qr: PhotoQr, legacy: boolean): PhotoKind {
  if (qr === null) return legacy ? { kind: "plain" } : { kind: "doubt", flag: "unreadableCard" };
  switch (qr.kind) {
    case "card":
      return qr;
    case "unreadable":
      return { kind: "doubt", flag: "unreadableCard" };
    case "otherCard":
      return { kind: "doubt", flag: "otherCard" };
    default:
      return { kind: "plain" };
  }
}

/** What a photo itself does to the photos after it (without what purged photos before it did). */
export function tagStep(photo: Pick<TaggingPhoto, "status" | "qr">, legacy: boolean): TagStep {
  if (photo.status !== "ready") return { card: null, flag: "afterFailed" };
  const k = kindOf(photo.qr, legacy);
  if (k.kind === "card") return { card: { cardId: k.cardId, childId: k.childId }, flag: null };
  if (k.kind === "doubt") return { card: null, flag: "afterUnreadable" };
  return NO_STEP;
}

/**
 * Which photos sit where purged photos might have been (Seenu, answer 13), from the end of the batch back. Purged
 * photos were just before the photo that carries their step (`before`), after the last photo before it that was
 * already in place then (not afterPurge); with `purgeTail`, after the batch's last such photo. A photo marked afterPurge
 * in that gap may be before or after them. `lost`: a photo carrying a step has itself moved since, so where its purged
 * photos were is unknown anywhere in the batch.
 */
function purgeGaps(
  photos: readonly TaggingPhoto[],
  purgeTail: boolean,
): { inGap: boolean[]; lost: boolean } {
  const inGap = photos.map(() => false);
  let lost = false;
  let open = purgeTail;
  for (let i = photos.length - 1; i >= 0; i--) {
    const photo = photos[i] as TaggingPhoto;
    if (photo.afterPurge) {
      inGap[i] = open;
      if (photo.before) lost = true;
    } else {
      open = Boolean(photo.before);
    }
  }
  return { inGap, lost };
}

/**
 * Tags one upload batch. `photos` must be in tagging order (compareTaggingOrder: capture time, then filename; D142 #7)
 * and include photos in the bin (marked binned: they get no tag but still count where they are). With `groupPhotos`
 * the batch is a group-photo upload (D156; was a class-photo upload, Seenu answer 3): every photo is a group photo, and
 * its groups are its links, written when it was registered, never by tagging. `purgeTail`: a purge left a step with
 * no photo after it. Results are for the photos not in the bin.
 *
 * In a batch of individual photos the target starts at Leftovers. A readable card makes its own photo a card photo and
 * sends the photos after it to the card's child (or, for a blank card, to that card until the studio names the
 * child). The same card again changes nothing, so a card shot twice in a row is ignored, and a card seen again later
 * (a retake) sends photos back to its child. A card that can't be read, or isn't this job's, stays with the current
 * target, flagged and hidden; the photos after it keep that target, flagged, until the next readable card. A photo that
 * failed or isn't processed yet gets no tag, and flags the photos after it.
 *
 * Purges (Seenu, answer 13): a photo that may sit where purged photos were (purgeGaps) is flagged afterPurge, as it may
 * belong before or after them. If one of those photos did something itself (a card, a flag), the order of the two
 * steps is unknown, so the photos from the one carrying the purged step on are flagged too, until the next card. A
 * purged card removed since flags the photos after it. If a photo carrying a step has moved, every photo is flagged.
 */
export function tagBatch(
  photos: readonly TaggingPhoto[],
  options: { groupPhotos: boolean; purgeTail?: boolean },
): TaggingResult[] {
  const legacy = isLegacyBatch(photos);
  const live = photos.filter((p) => !p.binned);
  if (options.groupPhotos) {
    return live.map((photo) => {
      if (photo.status !== "ready") return { photoId: photo.id, tag: null };
      const k = kindOf(photo.qr, legacy);
      // Cards inside group photos are hidden and otherwise ignored (Seenu, plan answer 8).
      if (k.kind === "card")
        return { photoId: photo.id, tag: { place: "card", cardId: k.cardId, flag: null } };
      return {
        photoId: photo.id,
        tag: { place: "groupPhoto", flag: k.kind === "doubt" ? k.flag : null },
      };
    });
  }

  let target: TagTarget = { place: "leftovers" };
  let carried: PhotoFlag | null = null;
  const apply = (step: TagStep) => {
    if (step.card) {
      const { cardId, childId } = step.card;
      if (cardId === null) {
        // A purged card removed since (its child was removed): whose photos follow can't be known (answer 13).
        carried = "afterPurge";
      } else {
        target = childId ? { place: "child", childId } : { place: "blankCard", cardId };
        carried = null;
      }
    }
    if (step.flag) carried = step.flag;
  };
  const { inGap, lost } = purgeGaps(photos, options.purgeTail === true);
  // A photo in a purge gap did something: the purged step and its own can't be put in order.
  let gapSteps = false;
  const results: TaggingResult[] = [];
  photos.forEach((photo, i) => {
    if (!photo.afterPurge) {
      if (photo.before) {
        apply(photo.before);
        if (gapSteps) carried = "afterPurge";
      }
      gapSteps = false;
    } else if (photo.before) {
      apply(photo.before);
    }
    const step = tagStep(photo, legacy);
    if (inGap[i] && (step.card || step.flag)) gapSteps = true;
    if (photo.binned) {
      apply(step);
      return;
    }
    if (photo.status !== "ready") {
      apply(step);
      results.push({ photoId: photo.id, tag: null });
      return;
    }
    const k = kindOf(photo.qr, legacy);
    if (k.kind === "card") {
      apply(step);
      results.push({ photoId: photo.id, tag: { place: "card", cardId: k.cardId, flag: null } });
      return;
    }
    if (k.kind === "doubt") {
      results.push({ photoId: photo.id, tag: { ...target, flag: k.flag } });
      apply(step);
      return;
    }
    const flag: PhotoFlag | null = lost || inGap[i] ? "afterPurge" : carried;
    results.push({ photoId: photo.id, tag: { ...target, flag } });
  });
  return results;
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
  t.place === "child" ? t.childId : t.place === "card" || t.place === "blankCard" ? t.cardId : null;

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

// ── What people can do with a photo at review ────────────────────────────────────────────────────────────────────

/**
 * What the worker read about a photo, as the review screen sees it: removedCard is one of the job's cards that has
 * since been removed (its child was deleted from a draft job); null: no result that reads cards.
 */
export type PhotoQrKind = "none" | "card" | "unreadable" | "otherCard" | "removedCard" | null;

export interface ReviewPhoto {
  status: TaggingPhoto["status"];
  place: PhotoPlace;
  flag: PhotoFlag | null;
  qrKind: PhotoQrKind;
  /** Moved or confirmed by a person. */
  manual: boolean;
}

export interface ReviewActions {
  /** Give to a person (or Leftovers): drag, or the Give to a person dialog. Never a group photo (C8). */
  move: boolean;
  /** "Looks right" / "It's a normal photo": keep it where it is, visible to parents once tagged to a child. */
  confirm: boolean;
  /** "This is a card photo": hidden from parents. */
  markCard: boolean;
  /**
   * Undo "This is a card photo" (Seenu, answer 12): back to Flagged, hidden until confirmed again. Owners and admins
   * only; screens offer it only to them.
   */
  undoCard: boolean;
}

/**
 * The review actions a photo allows (the database refuses the rest; security review 3-4, code review M1):
 * - card photos (read, or marked by a person) are never moved or confirmed again;
 * - a photo of another job's card (or a removed card) shows that card's child: it can only be marked a card photo;
 * - a photo that may be a card (unreadableCard) must be confirmed, either way, before it can be moved;
 * - a photo a person marked a card photo can be unmarked (owners and admins; Seenu, answer 12);
 * - a group photo never becomes a person's photo (D156, C8): it is confirmed or marked a card photo, never moved;
 * - photos still processing or failed have nothing to do.
 */
export function reviewActions(p: ReviewPhoto): ReviewActions {
  const none = { move: false, confirm: false, markCard: false, undoCard: false };
  if (p.status !== "ready" || p.qrKind === "card") return none;
  if (p.place === "card") return { ...none, undoCard: p.manual };
  if (p.qrKind === "otherCard" || p.qrKind === "removedCard" || p.flag === "otherCard")
    return { ...none, markCard: true };
  if (p.flag === "unreadableCard") return { ...none, confirm: true, markCard: true };
  if (p.place === "groupPhoto") return { ...none, confirm: true, markCard: true };
  return { move: true, confirm: true, markCard: true, undoCard: false };
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
