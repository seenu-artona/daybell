import { ApiError, contactIsEmpty, contactPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handle, parseBody } from "@/lib/api";
import { CONTACT_COLUMNS, type ContactRow, contactColumns, toContact } from "@/lib/people";
import { assertFunctionRegion } from "@/lib/region-guard";
import { assertCanManage, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// As /contacts: Canadian studios' contacts are changed in Montréal (D113).
export const preferredRegion = "yul1";

const NOT_FOUND = () => new ApiError("not_found", "Contact not found.");

/**
 * PATCH /api/v1/contacts/:id — owners and admins change one of the studio's contacts. Send null to clear a field; the
 * contact must still have a name, an email or a phone. isMain true makes it the client's main contact (the previous
 * one stays, no longer main); the database keeps the client's contact fields in step (ADR 0028). The main contact
 * can't be unticked: a client's main contact changes only by making someone else main.
 */
export const PATCH = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw NOT_FOUND();
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertCanManage(studio);
  const patch = await parseBody(request, contactPatch);
  const current = check(
    await supabase
      .from("client_contacts")
      .select(CONTACT_COLUMNS)
      .eq("studio_id", studio.id)
      .eq("id", id)
      .maybeSingle(),
  ) as ContactRow | null;
  if (!current) throw NOT_FOUND();
  // The main contact stays main until someone else is made main (so a client never loses it by an untick).
  if (current.is_main && patch.isMain === false)
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      isMain: "validation.mainContactStays",
    });
  // The contact as it will be: still someone.
  const merged = { ...toContact(current), ...patch };
  if (contactIsEmpty(merged))
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      firstName: "validation.contactEmpty",
    });
  const row = check(
    await supabase
      .from("client_contacts")
      .update(contactColumns(patch))
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select(CONTACT_COLUMNS)
      .maybeSingle(),
  ) as ContactRow | null;
  if (!row) throw NOT_FOUND();
  return NextResponse.json({ contact: toContact(row) });
});
