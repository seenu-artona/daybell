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

/** What a job's groups are called on screen: classes at school, teams in sports, groups otherwise. */
export type GroupLabel = "class" | "team" | "group";

const GROUP: Record<JobType, GroupLabel> = {
  school: "class",
  preschool: "class",
  sports: "team",
  dance: "class",
  seniors: "group",
  mini_session: "group",
};

export function groupLabel(type: JobType): GroupLabel {
  return GROUP[type];
}
