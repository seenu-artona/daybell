import { contactInput, contactListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody, parseQuery } from "@/lib/api";
import { assertClientInStudio } from "@/lib/jobs";
import {
  CONTACT_COLUMNS,
  type ContactRow,
  contactColumns,
  listContacts,
  toContact,
} from "@/lib/people";
import { assertCanManage, studioScope } from "@/lib/studio";

/**
 * GET /api/v1/contacts?show=main&clientId=&cursor=&limit= — the studio's contacts (People › Contacts, D150): by client,
 * the main contact first, in pages. No text in the address: POST /contacts/search takes a name or email (D113).
 */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(request, contactListQuery);
  const { supabase, studio } = await studioScope();
  return NextResponse.json(await listContacts(supabase, studio.id, query));
});

/**
 * POST /api/v1/contacts — owners and admins add a contact to one of the studio's clients. Made main, it takes over from
 * the client's previous main contact, and the database copies it to the client's contact fields (ADR 0028).
 */
export const POST = handle(async (request: Request) => {
  // Who and what role first: nobody else gets as far as reading the body (S4).
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const input = await parseBody(request, contactInput);
  await assertClientInStudio(supabase, studio.id, input.clientId);
  const row = check(
    await supabase
      .from("client_contacts")
      .insert({
        studio_id: studio.id,
        client_id: input.clientId,
        ...contactColumns({ ...input, isMain: input.isMain ?? false }),
      })
      .select(CONTACT_COLUMNS)
      .single(),
  ) as ContactRow;
  return NextResponse.json({ contact: toContact(row) }, { status: 201 });
});
