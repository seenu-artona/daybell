import { contactSearchInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { listContacts } from "@/lib/people";
import { studioScope } from "@/lib/studio";

/**
 * POST /api/v1/contacts/search — GET /contacts with part of a name or email. The text arrives in the body and goes to
 * the database as an RPC argument, so it never appears in a URL or request log, and it is never logged here (D113).
 */
export const POST = handle(async (request: Request) => {
  // Who is asking comes first, before the body is read (S4).
  const { supabase, studio } = await studioScope();
  const query = await parseBody(request, contactSearchInput);
  return NextResponse.json(await listContacts(supabase, studio.id, query));
});
