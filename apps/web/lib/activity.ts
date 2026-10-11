import { ACTIVITY_TYPES, type ActivityType } from "@daybell/api";

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

/** What a nameless subject is called when its name can't be looked up (e.g. it was deleted): jobs and roster imports
 * point at a job; client events (and legacy organization ones) at a client. */
export function unnamedSubject(type: ActivityType): "aJob" | "aClient" {
  return type.startsWith("job.") || type.startsWith("roster.") ? "aJob" : "aClient";
}
