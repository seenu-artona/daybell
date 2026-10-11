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
