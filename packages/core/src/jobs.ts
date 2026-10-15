/**
 * Jobs (Phase 1 step 1, ADR 0008 and 0009). The same lists live as enums in the database
 * (packages/db migrations); a test in packages/api keeps them in step.
 */
export const JOB_TYPES = [
  "school",
  "preschool",
  "sports",
  "dance",
  "seniors",
  "mini_session",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["draft", "selling", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * What a job calls the roster's class field (Class, Team, Homeroom…): its template's label, copied when the job is made
 * (Seenu's answer to ADR 0030 call 29, replacing D137's words by job type). Free text, trimmed, 1 to 30 characters.
 */
export const DEFAULT_CLASS_LABEL = "Class";
export const MAX_CLASS_LABEL = 30;

/** A label as typed, with runs of spaces made one and the ends trimmed. */
export function cleanClassLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

/** Whether a cleaned label can be a template's: 1 to 30 characters, no control characters. */
export function classLabelValid(label: string): boolean {
  return (
    label.length >= 1 &&
    label.length <= MAX_CLASS_LABEL &&
    label === label.trim() &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
    !/[\u0000-\u001F\u007F]/.test(label)
  );
}
