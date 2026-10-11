import { ApiError, type ClientInput, clientPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handle, parseBody } from "@/lib/api";
import { CLIENT_COLUMNS, type ClientRow, clientColumns, toClient, validClient } from "@/lib/jobs";
import { assertCanManage, studioScope } from "@/lib/studio";

/** PATCH /api/v1/clients/:id — owners and admins change a client. Send null to clear a field. */
export const PATCH = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "Client not found.");
  const patch = await parseBody(request, clientPatch);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const current = check(
    await supabase
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("studio_id", studio.id)
      .eq("id", id)
      .maybeSingle(),
  ) as ClientRow | null;
  if (!current) throw new ApiError("not_found", "Client not found.");
  // The client as it will be, checked as a whole (e.g. a new region must not make it a Quebec address).
  const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = toClient(current);
  const next = validClient({ ...fields, ...patch });
  const row = check(
    await supabase
      .from("clients")
      .update(clientColumns(next, Object.keys(patch) as (keyof ClientInput)[]))
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select(CLIENT_COLUMNS)
      .maybeSingle(),
  ) as ClientRow | null;
  if (!row) throw new ApiError("not_found", "Client not found.");
  return NextResponse.json({ client: toClient(row) });
});
