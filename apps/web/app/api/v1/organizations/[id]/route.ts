import { ApiError, type OrganizationInput, organizationPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handle, parseBody } from "@/lib/api";
import {
  ORGANIZATION_COLUMNS,
  type OrganizationRow,
  organizationColumns,
  toOrganization,
  validOrganization,
} from "@/lib/jobs";
import { assertCanManage, studioScope } from "@/lib/studio";

/** PATCH /api/v1/organizations/:id — owners and admins change an organization. Send null to clear a field. */
export const PATCH = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "Organization not found.");
  const patch = await parseBody(request, organizationPatch);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const current = check(
    await supabase
      .from("organizations")
      .select(ORGANIZATION_COLUMNS)
      .eq("studio_id", studio.id)
      .eq("id", id)
      .maybeSingle(),
  ) as OrganizationRow | null;
  if (!current) throw new ApiError("not_found", "Organization not found.");
  // The organization as it will be, checked as a whole (e.g. a new region must not make it a Quebec address).
  const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = toOrganization(current);
  const next = validOrganization({ ...fields, ...patch });
  const row = check(
    await supabase
      .from("organizations")
      .update(organizationColumns(next, Object.keys(patch) as (keyof OrganizationInput)[]))
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select(ORGANIZATION_COLUMNS)
      .maybeSingle(),
  ) as OrganizationRow | null;
  if (!row) throw new ApiError("not_found", "Organization not found.");
  return NextResponse.json({ organization: toOrganization(row) });
});
