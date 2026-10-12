import { ACTIVITY_TYPES, type ActivityType } from "@daybell/api";
import type { IconChipTone } from "@daybell/ui";

const KNOWN = new Set<string>(ACTIVITY_TYPES);

/** Event types from before organizations became clients (ADR 0009). Events never change, so they are renamed here. */
const RENAMED: Record<string, ActivityType> = {
  "organization.created": "client.created",
  "organization.updated": "client.updated",
};

/** The activity type to show for a stored event type, or null if the activity log doesn't show it. */
export function activityType(stored: string): ActivityType | null {
  const type = RENAMED[stored] ?? stored;
  return KNOWN.has(type) ? (type as ActivityType) : null;
}

/**
 * Every stored event type the activity log shows (current names and the legacy ones it renames), for filtering in the
 * query itself, so hidden events (each child or class change) never push shown ones out of the latest 50.
 */
export const STORED_ACTIVITY_TYPES: readonly string[] = [
  ...ACTIVITY_TYPES,
  ...Object.keys(RENAMED),
];

/** Event types whose subject is a job: the job's own changes, roster imports and QR card prints (ADR 0015). */
export const JOB_SUBJECT_PREFIXES = ["job.", "roster.", "qr_cards."] as const;

const aboutJob = (type: string) => JOB_SUBJECT_PREFIXES.some((prefix) => type.startsWith(prefix));

/**
 * The stored types a job's own activity shows (GET /studio/activity?jobId=): changes to the job, its roster imports
 * and QR card prints (Seenu, answer 6). Each child and class change stays hidden, as on the studio-wide log.
 */
export const JOB_ACTIVITY_TYPES: readonly string[] = STORED_ACTIVITY_TYPES.filter(aboutJob);

/** What a nameless subject is called when its name can't be looked up (e.g. it was deleted): jobs, roster imports
 * and QR card prints point at a job; client events (and legacy organization ones) at a client. */
export function unnamedSubject(type: ActivityType): "aJob" | "aClient" {
  return aboutJob(type) ? "aJob" : "aClient";
}

/** The icon on an activity row's chip; the component maps each to a lucide icon. */
export type ActivityIcon = "created" | "edited" | "imported" | "printed" | "team" | "studio";

/**
 * The pastel chip at the start of an activity row (D140): new things green, edits amber, imports and QR card prints
 * blue, team changes lime, studio changes grey. Decorative only: the sentence says what happened.
 */
export function activityChip(type: ActivityType): { tone: IconChipTone; icon: ActivityIcon } {
  if (type === "roster.imported") return { tone: "info", icon: "imported" };
  if (type === "qr_cards.printed") return { tone: "info", icon: "printed" };
  if (type.startsWith("member.") || type.startsWith("invite."))
    return { tone: "lime", icon: "team" };
  if (type.startsWith("studio.")) return { tone: "neutral", icon: "studio" };
  if (type.endsWith(".created")) return { tone: "primary", icon: "created" };
  return { tone: "warning", icon: "edited" };
}
