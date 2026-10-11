import { DATA_REGIONS } from "@daybell/config";
import { JOB_STATUSES, JOB_TYPES } from "@daybell/core";
import { z } from "zod";

/**
 * Response shapes for /api/v1, defined once as schemas: TypeScript types come from them, and so do the API docs (D92).
 */
export const STUDIO_ROLES = ["owner", "admin", "photographer", "staff"] as const;
export const studioRole = z
  .enum(STUDIO_ROLES)
  .meta({ description: "What a person may do in a studio." });
export type StudioRole = z.infer<typeof studioRole>;

export const studioSummary = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string().meta({ description: "The studio's web address, e.g. north-peak." }),
    region: z.enum(DATA_REGIONS).meta({ description: "Where the studio's data lives (D113)." }),
    role: studioRole.meta({ description: "The signed-in person's role here." }),
  })
  .meta({ id: "StudioSummary" });
export type StudioSummary = z.infer<typeof studioSummary>;

export const meResponse = z.object({ email: z.email(), studio: studioSummary.nullable() }).meta({
  id: "Me",
  description: "The signed-in person and their studio (null until they belong to one).",
});
export type MeResponse = z.infer<typeof meResponse>;

export const teamMember = z
  .object({ userId: z.uuid(), email: z.email(), role: studioRole })
  .meta({ id: "TeamMember" });
export type TeamMember = z.infer<typeof teamMember>;

export const pendingInvite = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(["admin", "photographer", "staff"]),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "PendingInvite" });
export type PendingInvite = z.infer<typeof pendingInvite>;

export const ACTIVITY_TYPES = [
  "studio.created",
  "studio.updated",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "invite.created",
  "invite.accepted",
  "invite.withdrawn",
  "client.created",
  "client.updated",
  "job.created",
  "job.updated",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activityItem = z
  .object({
    id: z.number().int(),
    type: z.enum(ACTIVITY_TYPES),
    actorEmail: z.email().nullable().meta({ description: "Who did it, if still on the team." }),
    subjectEmail: z
      .email()
      .nullable()
      .meta({ description: "Who it was about, for member events." }),
    role: studioRole.nullable(),
    subjectName: z.string().nullable().meta({
      description: "The job's or client's current name, for job and client events.",
    }),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    id: "ActivityItem",
    description: "One line of the studio's activity log. Events store IDs only (D96).",
  });
export type ActivityItem = z.infer<typeof activityItem>;

export const teamResponse = z.object({ team: z.array(teamMember) });
export const invitesResponse = z.object({ invites: z.array(pendingInvite) });
export const inviteCreatedResponse = z.object({
  link: z.url().meta({
    description: "Send this to the invited person. Works once, for their email, for 7 days.",
  }),
});
export const activityResponse = z.object({ activity: z.array(activityItem) });
export const checkEmailResponse = z.object({ status: z.literal("check_email") });

// ── Clients and jobs (Phase 1 step 1, ADR 0008 and 0009) ──────────────────────────────────────────────────────────
const nextCursor = z
  .uuid()
  .nullable()
  .meta({ description: "Pass as ?cursor= for the next page; null on the last page." });

export const client = z
  .object({
    id: z.uuid(),
    name: z.string(),
    addressLine1: z.string().nullable(),
    addressLine2: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable().meta({ description: "State or province code." }),
    country: z.enum(["US", "CA"]).nullable(),
    contactFirstName: z.string().nullable(),
    contactLastName: z.string().nullable(),
    contactPhone: z.string().nullable(),
    contactEmail: z.string().nullable(),
    notes: z.string().nullable().meta({ description: "Only visible to the studio." }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    id: "Client",
    description: "A school, daycare, team or family the studio photographs for.",
  });
export type Client = z.infer<typeof client>;

export const clientRef = z
  .object({ id: z.uuid(), name: z.string(), city: z.string().nullable() })
  .meta({ id: "ClientRef" });

export const jobCategory = z
  .object({ id: z.uuid(), name: z.string(), position: z.number().int() })
  .meta({ id: "JobCategory", description: "A studio's job category, e.g. Fall or Graduation." });
export type JobCategory = z.infer<typeof jobCategory>;

export const job = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES).meta({ description: "New jobs are drafts." }),
    pictureDay: z.iso.date(),
    client: clientRef.nullable(),
    internalNumber: z.string().meta({ description: "Only the studio sees it." }),
    category: jobCategory.pick({ id: true, name: true }),
    subjectsExpected: z.number().int().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "Job", description: "A shoot or season the studio photographs and sells." });
export type Job = z.infer<typeof job>;

export const jobsResponse = z.object({ jobs: z.array(job), nextCursor });
export type JobsResponse = z.infer<typeof jobsResponse>;
export const jobResponse = z.object({ job });
export const nextJobNumberResponse = z.object({
  internalNumber: z.string().meta({ description: "The next free JOBnnnnn number." }),
});
export const clientsResponse = z.object({ clients: z.array(client), nextCursor });
export type ClientsResponse = z.infer<typeof clientsResponse>;
export const clientResponse = z.object({ client });
export const jobCategoriesResponse = z.object({ categories: z.array(jobCategory) });
export type JobCategoriesResponse = z.infer<typeof jobCategoriesResponse>;
