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
