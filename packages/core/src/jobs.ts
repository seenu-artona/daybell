/**
 * Jobs and organizations (Phase 1 step 1, ADR 0008). The same lists live as enums in the database
 * (packages/db migration 20261011040000); a test in packages/api keeps them in step.
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

export const ORGANIZATION_KINDS = [
  "school",
  "daycare",
  "club",
  "league",
  "dance_studio",
  "other",
] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/** What a job's groups are called on screen: classes at school, teams in sports, groups otherwise. */
export type GroupLabel = "class" | "team" | "group";

export interface JobTypeRule {
  group: GroupLabel;
  /** The kind pre-selected when creating an organization for this type of job. */
  organizationKind: OrganizationKind;
  /** School, preschool, sports and dance jobs are for an organization; seniors and mini sessions may not be. */
  organizationRequired: boolean;
}

const RULES: Record<JobType, JobTypeRule> = {
  school: { group: "class", organizationKind: "school", organizationRequired: true },
  preschool: { group: "class", organizationKind: "daycare", organizationRequired: true },
  sports: { group: "team", organizationKind: "league", organizationRequired: true },
  dance: { group: "class", organizationKind: "dance_studio", organizationRequired: true },
  seniors: { group: "group", organizationKind: "school", organizationRequired: false },
  mini_session: { group: "group", organizationKind: "other", organizationRequired: false },
};

export function jobTypeRule(type: JobType): JobTypeRule {
  return RULES[type];
}

export function organizationRequired(type: JobType): boolean {
  return RULES[type].organizationRequired;
}
