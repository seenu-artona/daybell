import "server-only";
import {
  ApiError,
  GROUP_CONFLICTS,
  type GroupMember,
  type PhotoGroup,
  type PhotoGroupsResponse,
  type PhotoPerson,
} from "@daybell/api";
import { sortPhotoGroups } from "@daybell/core";
import type { PhotoStorage } from "@daybell/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";
import { photoError } from "./photos";
import { type TaggedPhotoRow, taggingError, toTaggedPhoto } from "./tagging";

/**
 * Server helpers for Photos' People and Groups (D156; ADR 0030). Only ids go in URLs and logs: names of people and
 * groups are read from the database and sent to the studio's own screens only.
 */

type DbError = { code?: string; message?: string } | null;

const conflict = (message: string, form: string) => new ApiError("conflict", message, { form });

/** The named refusals of the group functions (their messages carry no values), as API errors. */
const NAMED: Record<string, () => ApiError> = {
  group_name_taken: () =>
    conflict("Another group of this job has that name.", GROUP_CONFLICTS.nameTaken),
  group_limit: () => conflict("A job holds at most 500 groups.", GROUP_CONFLICTS.limit),
  photo_sold: () =>
    conflict(
      "A photo that has sold can't be moved to the bin. Move the group's photos to another group.",
      GROUP_CONFLICTS.photoSold,
    ),
  job_closed: () =>
    conflict("This job is closed, so its groups don't change.", GROUP_CONFLICTS.jobClosed),
  group_not_in_job: () =>
    conflict("Those people, photos or groups aren't this job's.", GROUP_CONFLICTS.notInJob),
  not_group_photo: () =>
    conflict("Only this job's group photos go in groups.", GROUP_CONFLICTS.notInJob),
  group_has_photos: () =>
    conflict("Say where this group's photos go before deleting it.", GROUP_CONFLICTS.hasPhotos),
};

/** A group function's refusal as an API error; anything else as tagging and photos map it. */
export function groupError(error: NonNullable<DbError>): ApiError {
  const named = error.code === "P0001" && error.message ? NAMED[error.message] : undefined;
  if (named) return named();
  return taggingError(error);
}

export function groupResult<T>(result: { data: unknown; error: DbError }): T {
  if (result.error) throw groupError(result.error);
  return result.data as T;
}

/** An upload's refusal: a group of another job is the group's (groups.notInJob); the rest are the photos'. */
export function uploadBatchResult<T>(result: { data: unknown; error: DbError }): T {
  if (!result.error) return result.data as T;
  if (result.error.code === "P0001" && result.error.message === "group_not_in_job")
    throw NAMED.group_not_in_job?.();
  throw photoError(result.error);
}

export interface PhotoGroupRow {
  id: string;
  job_id: string;
  name: string;
}

/** A group of the studio, through row-level security (another studio's group is simply not found). */
export async function loadPhotoGroup(
  supabase: SupabaseClient,
  studioId: string,
  groupId: string,
): Promise<PhotoGroupRow> {
  const row = check(
    await supabase
      .from("photo_groups")
      .select("id, job_id, name")
      .eq("studio_id", studioId)
      .eq("id", groupId)
      .maybeSingle(),
  ) as PhotoGroupRow | null;
  if (!row) throw new ApiError("not_found", "Group not found.");
  return row;
}

interface ListedGroup {
  id: string;
  name: string;
  members: number;
  photos: number;
  ordered: number | null;
}

/** A job's groups (by name, natural order) and how many group photos are in no group, through row-level security. */
export async function readPhotoGroups(
  supabase: SupabaseClient,
  jobId: string,
): Promise<PhotoGroupsResponse> {
  const data = check(await supabase.rpc("list_photo_groups", { p_job_id: jobId })) as {
    groups: ListedGroup[];
    not_in_group: number;
  } | null;
  return {
    groups: sortPhotoGroups((data?.groups ?? []).map(toPhotoGroup)),
    notInGroup: Number(data?.not_in_group ?? 0),
  };
}

export function toPhotoGroup(row: ListedGroup): PhotoGroup {
  return {
    id: row.id,
    name: row.name,
    members: Number(row.members),
    photos: Number(row.photos),
    ordered: row.ordered === null || row.ordered === undefined ? null : Number(row.ordered),
  };
}

/** One group as the Groups list has it (a job holds at most 500, so the list is read whole). */
export async function readPhotoGroup(
  supabase: SupabaseClient,
  jobId: string,
  groupId: string,
): Promise<PhotoGroup> {
  const { groups } = await readPhotoGroups(supabase, jobId);
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new ApiError("not_found", "Group not found.");
  return group;
}

export interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  class_id: string | null;
  class_name: string | null;
}

export function toGroupMember(row: MemberRow): GroupMember {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    class: row.class_id ? { id: row.class_id, name: row.class_name ?? "" } : null,
  };
}

export interface PersonRow {
  id: string;
  first_name: string;
  last_name: string;
  photos: number;
  card_photos: number;
  strip: TaggedPhotoRow[];
}

/** A person's line on People, with signed 400 px previews (studio only). */
export async function toPhotoPerson(
  storage: PhotoStorage,
  ids: { studioId: string; jobId: string },
  row: PersonRow,
): Promise<PhotoPerson> {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    photos: Number(row.photos),
    cardPhotos: Number(row.card_photos),
    strip: await Promise.all(row.strip.map((photo) => toTaggedPhoto(storage, ids, photo))),
  };
}
