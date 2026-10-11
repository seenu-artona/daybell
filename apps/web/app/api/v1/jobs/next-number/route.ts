import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { nextJobNumber } from "@/lib/jobs";
import { assertCanManage, studioScope } from "@/lib/studio";

/** GET /api/v1/jobs/next-number — the suggested internal number for a new job (owners and admins). */
export const GET = handle(async () => {
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  return NextResponse.json({ internalNumber: await nextJobNumber(supabase, studio.id) });
});
