import type { DataRegion } from "@daybell/config";

export type StudioRole = "owner" | "admin" | "photographer" | "staff";

export interface StudioSummary {
  id: string;
  name: string;
  slug: string;
  region: DataRegion;
  role: StudioRole;
}

export interface TeamMember {
  userId: string;
  email: string;
  role: StudioRole;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Exclude<StudioRole, "owner">;
  expiresAt: string;
}

export interface MeResponse {
  email: string;
  studio: StudioSummary | null;
}

export const ACTIVITY_TYPES = [
  "studio.created",
  "studio.updated",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "invite.created",
  "invite.accepted",
  "invite.withdrawn",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** One line of the studio's activity log. Names are resolved from the team list; events store IDs only. */
export interface ActivityItem {
  id: number;
  type: ActivityType;
  actorEmail: string | null;
  subjectEmail: string | null;
  role: StudioRole | null;
  occurredAt: string;
}
