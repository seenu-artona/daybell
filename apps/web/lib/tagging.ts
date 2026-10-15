import "server-only";
import {
  ApiError,
  type MoveTarget,
  QR_CARD_CONFLICTS,
  TAGGING_CONFLICTS,
  type TaggedPhoto,
} from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import {
  type PhotoFlag,
  type PhotoPlace,
  type PhotoQr,
  type PhotoQrKind,
  planTagWrites,
  reviewActions,
  type StoredTag,
  type Tag,
  type TaggingPhoto,
  type TagStep,
  type TagWrite,
  tagBatch,
} from "@daybell/core";
import type { PhotoStorage } from "@daybell/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { photoError, photoResult, previewUrl } from "./photos";
import { photoSystemRpc } from "./supabase/service";

/**
 * Server helpers for QR tagging (Phase 1 step 5; ADR 0018). The rules are packages/core's tagBatch; this file reads a
 * batch from the database, runs them and writes the changes for the round it read. Only ids go in logs: never card
 * codes, names or filenames.
 */

type DbError = { code?: string; message?: string } | null;

// ── Database names ↔ core names ───────────────────────────────────────────────────────────────────────────────────

const PLACE_FROM_DB: Record<string, PhotoPlace> = {
  child: "child",
  group_photo: "groupPhoto",
  leftovers: "leftovers",
  card: "card",
  blank_card: "blankCard",
};
const PLACE_TO_DB: Record<PhotoPlace, string> = {
  child: "child",
  groupPhoto: "group_photo",
  leftovers: "leftovers",
  card: "card",
  blankCard: "blank_card",
};
const FLAG_FROM_DB: Record<string, PhotoFlag> = {
  unreadable_card: "unreadableCard",
  other_card: "otherCard",
  after_unreadable: "afterUnreadable",
  after_failed: "afterFailed",
  after_purge: "afterPurge",
};
const FLAG_TO_DB: Record<PhotoFlag, string> = {
  unreadableCard: "unreadable_card",
  otherCard: "other_card",
  afterUnreadable: "after_unreadable",
  afterFailed: "after_failed",
  afterPurge: "after_purge",
};

export const placeFromDb = (place: string): PhotoPlace => PLACE_FROM_DB[place] ?? "leftovers";
export const flagFromDb = (flag: string | null): PhotoFlag | null =>
  flag ? (FLAG_FROM_DB[flag] ?? null) : null;

/** A stored tag row, as tagging_inputs and the review reads return it. */
export interface TagRow {
  place: string;
  child_id: string | null;
  card_id: string | null;
  flag: string | null;
  source: "auto" | "manual";
}

export function tagFromRow(row: TagRow): StoredTag {
  const flag = flagFromDb(row.flag);
  const place = placeFromDb(row.place);
  const base = (): Tag => {
    switch (place) {
      case "child":
        return { place, childId: row.child_id ?? "", flag };
      case "groupPhoto":
        return { place, flag };
      case "card":
        return { place, cardId: row.card_id, flag };
      case "blankCard":
        return { place, cardId: row.card_id ?? "", flag };
      default:
        return { place: "leftovers", flag };
    }
  };
  return { ...base(), source: row.source };
}

/** One write as apply_batch_tags takes it. */
export function writeRow(write: TagWrite): Record<string, string | null> {
  const t = write.tag;
  if (!t) return { photo_id: write.photoId, place: null };
  return {
    photo_id: write.photoId,
    place: PLACE_TO_DB[t.place],
    child_id: t.place === "child" ? t.childId : null,
    card_id: t.place === "card" || t.place === "blankCard" ? t.cardId : null,
    flag: t.flag ? FLAG_TO_DB[t.flag] : null,
  };
}

// ── Tagging a batch ───────────────────────────────────────────────────────────────────────────────────────────────

/** What tagging_inputs returns. */
export interface TaggingInputs {
  batch_id: string;
  /** individual photos (split by QR card) or group photos (D156; ADR 0030). */
  kind: "individual" | "group";
  tag_round: number;
  tagged_round: number;
  /** A purge left a step with no photo after it (Seenu, answer 13). */
  purge_tail?: boolean;
  processing: number;
  processing_stuck: number;
  photos: {
    id: string;
    status: TaggingPhoto["status"];
    qr_kind: "none" | "card" | "unreadable" | "other_card" | null;
    card_id: string | null;
    card_child_id: string | null;
    /** In the bin: no tag, but it still marks where cards were (security review 1). */
    binned: boolean;
    /** It came into the batch's order, or moved in it, after a purge left a step (answer 13). */
    after_purge?: boolean;
    /** What photos purged from the bin just before this one did. */
    before: {
      card: boolean;
      card_id: string | null;
      card_child_id: string | null;
      flag: "after_unreadable" | "after_failed" | null;
    } | null;
    tag: TagRow | null;
  }[];
}

/** What the worker read, as tagging's rules see it. A card that was deleted counts as another job's card. */
export function photoQr(p: TaggingInputs["photos"][number]): PhotoQr {
  switch (p.qr_kind) {
    case null:
      return null;
    case "card":
      return p.card_id
        ? { kind: "card", cardId: p.card_id, childId: p.card_child_id }
        : { kind: "otherCard" };
    case "other_card":
      return { kind: "otherCard" };
    case "unreadable":
      return { kind: "unreadable" };
    default:
      return { kind: "none" };
  }
}

/** What purged photos before a photo did, as tagging's rules see it. A card since removed keeps a null card id. */
export function beforeStep(before: TaggingInputs["photos"][number]["before"]): TagStep | null {
  if (!before) return null;
  return {
    card: before.card ? { cardId: before.card_id, childId: before.card_child_id } : null,
    flag:
      before.flag === null
        ? null
        : before.flag === "after_failed"
          ? "afterFailed"
          : "afterUnreadable",
  };
}

/** The writes a batch needs: tagBatch's result, less what is already right and what people tagged by hand. */
export function planBatch(inputs: TaggingInputs): TagWrite[] {
  const photos: TaggingPhoto[] = inputs.photos.map((p) => ({
    id: p.id,
    status: p.status,
    qr: photoQr(p),
    binned: p.binned === true,
    before: beforeStep(p.before ?? null),
    afterPurge: p.after_purge === true,
  }));
  const current = new Map(
    inputs.photos.flatMap((p) => (p.tag ? [[p.id, tagFromRow(p.tag)] as const] : [])),
  );
  return planTagWrites(
    current,
    tagBatch(photos, {
      groupPhotos: inputs.kind === "group",
      purgeTail: inputs.purge_tail === true,
    }),
  );
}

/** Tries before leaving a batch to the daily sweep, when other changes keep moving its round on. */
const TAGGING_TRIES = 3;

export type TaggingOutcome = "tagged" | "upToDate" | "waiting" | "stale" | "missing";

/**
 * Tags one upload batch now, for the round it reads. A batch with photos still processing waits for them (their
 * results tag it again), unless `force` and they are all stuck (the daily sweep): then they count as photos that
 * couldn't be read, and the photos after them are flagged. A run that read a round that has since moved on is tried
 * again, then left to the sweep. Tagging never overwrites what people moved by hand.
 */
export async function tagBatchNow(
  region: DataRegion,
  batchId: string,
  options: { force?: boolean } = {},
): Promise<TaggingOutcome> {
  for (let attempt = 1; attempt <= TAGGING_TRIES; attempt++) {
    const inputs = photoResult<TaggingInputs | null>(
      await photoSystemRpc(region, "tagging_inputs", { p_batch_id: batchId }),
    );
    if (!inputs) return "missing";
    const round = Number(inputs.tag_round);
    if (round === Number(inputs.tagged_round)) return "upToDate";
    const processing = Number(inputs.processing);
    if (processing > 0 && !(options.force && processing === Number(inputs.processing_stuck)))
      return "waiting";
    const writes = planBatch(inputs).map(writeRow);
    const result = await photoSystemRpc(region, "apply_batch_tags", {
      p_batch_id: batchId,
      p_round: round,
      p_writes: writes,
    });
    if (result.error?.code === "P0001" && result.error.message === "tagging_stale") continue;
    photoResult(result);
    return "tagged";
  }
  // The batch id only.
  console.error("tagging_stale", batchId);
  return "stale";
}

/** Tags the batches of some photos (after a worker result, the bin or a restore). Failures are logged, by id only. */
export async function tagBatchesOfPhotos(region: DataRegion, photoIds: readonly string[]) {
  try {
    const batches = photoResult<{ id: string }[]>(
      await photoSystemRpc(region, "batches_of_photos", { p_photo_ids: photoIds }),
    );
    for (const { id } of batches) await tagBatchNow(region, id);
  } catch (err) {
    console.error("tagging_failed", err instanceof Error ? err.name : "unknown");
  }
}

/**
 * Tags every batch of a job whose round has moved on (e.g. after a blank card's child is named, ADR 0018), read through
 * row-level security. Failures are logged by batch id only and never thrown; the daily sweep tries again.
 */
export async function tagDueBatchesOfJob(
  supabase: SupabaseClient,
  region: DataRegion,
  studioId: string,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("upload_batches")
    .select("id, tag_round, tagged_round")
    .eq("studio_id", studioId)
    .eq("job_id", jobId);
  if (error) {
    console.error("tagging_failed", jobId);
    return;
  }
  const due = ((data ?? []) as { id: string; tag_round: number; tagged_round: number }[]).filter(
    (b) => Number(b.tag_round) > Number(b.tagged_round),
  );
  for (const { id } of due) await tagBatchQuietly(region, id);
}

/** Tags one batch, logging a failure by its id only. For after() callbacks, which must never throw. */
export async function tagBatchQuietly(region: DataRegion, batchId: string) {
  try {
    await tagBatchNow(region, batchId);
  } catch (err) {
    console.error("tagging_failed", batchId, err instanceof Error ? err.name : "unknown");
  }
}

// ── Review reads ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A photo row from tagging_photos or a child's strip. */
export interface TaggedPhotoRow {
  id: string;
  status: "uploading" | "processing" | "ready" | "failed";
  place: string;
  flag: string | null;
  child_id?: string | null;
  card_id?: string | null;
  source: "auto" | "manual";
  qr_kind: string | null;
  /** Whether the photo's card is still one of the job's (qr_card_id is set). */
  qr_card?: boolean;
}

/** What the worker read, for the review screen: a card of the job that has since gone is a removed card. */
export function qrKindOf(row: Pick<TaggedPhotoRow, "qr_kind" | "qr_card">): PhotoQrKind {
  switch (row.qr_kind) {
    case "none":
      return "none";
    case "unreadable":
      return "unreadable";
    case "other_card":
      return "otherCard";
    case "card":
      return row.qr_card === false ? "removedCard" : "card";
    default:
      return null;
  }
}

/** A tagged photo for the review screen, with a signed 400 px preview (studio only). Never its filename. */
export async function toTaggedPhoto(
  storage: PhotoStorage,
  ids: { studioId: string; jobId: string },
  row: TaggedPhotoRow,
): Promise<TaggedPhoto> {
  const status = row.status === "uploading" ? "processing" : row.status;
  const place = placeFromDb(row.place);
  const flag = flagFromDb(row.flag);
  const qrKind = qrKindOf(row);
  return {
    id: row.id,
    status,
    place,
    flag,
    childId: row.child_id ?? null,
    cardId: row.card_id ?? null,
    manual: row.source === "manual",
    cardRead: qrKind === "card",
    qrKind,
    actions: reviewActions({ status, place, flag, qrKind, manual: row.source === "manual" }),
    thumbUrl:
      row.status === "ready"
        ? await previewUrl(storage, { ...ids, photoId: row.id }, "thumb.webp")
        : null,
  };
}

/** A move's target as move_photos takes it: ids only. A person, or Leftovers (never a group: C8). */
export function targetRow(target: MoveTarget): { kind: string; id?: string } {
  switch (target.kind) {
    case "child":
      return { kind: "child", id: target.childId };
    case "leftovers":
      return { kind: "leftovers" };
  }
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────

const conflict = (message: string, form: string) => new ApiError("conflict", message, { form });

const NAMED: Record<string, () => ApiError> = {
  card_photo: () =>
    conflict("Card photos stay card photos and can't be moved.", TAGGING_CONFLICTS.cardPhoto),
  photo_not_ready: () =>
    conflict(
      "Only processed photos that aren't in the bin can be moved or confirmed.",
      TAGGING_CONFLICTS.photoNotReady,
    ),
  card_claimed: () =>
    conflict("This card's child has already been named.", TAGGING_CONFLICTS.cardClaimed),
  confirm_first: () =>
    conflict(
      "Photos that may be a card are confirmed (a card photo, or a normal photo) before they can be moved.",
      TAGGING_CONFLICTS.confirmFirst,
    ),
  other_card: () =>
    conflict(
      "A photo of another job's card can only be marked a card photo.",
      TAGGING_CONFLICTS.otherCard,
    ),
  not_marked_card: () =>
    conflict(
      "Only photos a person marked as card photos can be unmarked.",
      TAGGING_CONFLICTS.notMarkedCard,
    ),
  group_photo: () =>
    conflict(
      "Group photos stay group photos: they are moved between groups, never given to a person.",
      TAGGING_CONFLICTS.groupPhoto,
    ),
  tagging_not_ready: () =>
    conflict(
      "Tagging can be marked reviewed once there are no Leftovers, flagged photos or blank cards to name.",
      TAGGING_CONFLICTS.notReady,
    ),
};

/** The named refusals of the tagging functions (their messages carry no values), as API errors. */
export function taggingError(error: NonNullable<DbError>): ApiError {
  const named = error.code === "P0001" && error.message ? NAMED[error.message] : undefined;
  if (named) return named();
  return photoError(error);
}

export function taggingResult<T>(result: { data: unknown; error: DbError }): T {
  if (result.error) throw taggingError(result.error);
  return result.data as T;
}

/** A blank card whose access code can't be read (a wrong key): never claimed with a code nobody can print. */
export const CARD_CODE_UNREADABLE = conflict(
  "This card's access code can't be read, so its child can't be added from it.",
  QR_CARD_CONFLICTS.codesUnreadable,
);
