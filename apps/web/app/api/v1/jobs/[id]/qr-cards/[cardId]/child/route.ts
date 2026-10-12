import { ApiError, claimBlankCardInput } from "@daybell/api";
import { decryptCardAccessCode, encryptAccessCode } from "@daybell/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accessCodeCryptoKeys } from "@/lib/access-codes";
import { check, handle, parseBody } from "@/lib/api";
import { assertFunctionRegion } from "@/lib/region-guard";
import {
  assertGroupInJob,
  CHILD_COLUMNS,
  type ChildRow,
  isDuplicate,
  loadRoster,
  loadRosterJob,
  toChild,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";
import { codeWriteRpc } from "@/lib/supabase/service";
import { CARD_CODE_UNREADABLE, tagDueBatchesOfJob, taggingResult } from "@/lib/tagging";

export const runtime = "nodejs";
// Access codes are decrypted here, in memory, in the studio's region (D113; ADR 0015).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string; cardId: string }> };

/**
 * POST /api/v1/jobs/:id/qr-cards/:cardId/child — names a blank card's child at review (Seenu, answer 2; ADR 0018). The
 * child joins the roster, in one of the job's existing classes or none (plan answer 6), with the blank card's own
 * access code, so the card already handed out keeps working: the card's encrypted copy is decrypted in memory and
 * re-encrypted for the new child's id, and the database moves the code's hash to the child in ADR 0015's order. The
 * card's photos go to the child. Owners, admins and photographers. Names travel in the body only; nothing is logged
 * but ids.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { id: jobId, cardId } = await ctx.params;
  if (!z.uuid().safeParse(jobId).success || !z.uuid().safeParse(cardId).success)
    throw new ApiError("not_found", "Card not found.");
  // Who, their role and the region before the body (S4).
  const { supabase, studio, userId } = await studioScope();
  assertCanEditRoster(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, claimBlankCardInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const group = await assertGroupInJob(supabase, studio.id, jobId, input.groupId);

  const cardCopy = taggingResult<string>(
    await codeWriteRpc(studio.region, "blank_card_code", userId, {
      p_job_id: jobId,
      p_card_id: cardId,
    }),
  );
  const keys = await accessCodeCryptoKeys();
  let code: string;
  try {
    code = await decryptCardAccessCode(cardCopy, cardId, keys.encryption);
  } catch {
    // A fixed event name and the card's id only (ADR 0015).
    console.error("access_code_unreadable", cardId);
    throw CARD_CODE_UNREADABLE;
  }
  const childId = crypto.randomUUID();
  taggingResult(
    await codeWriteRpc(studio.region, "claim_blank_card", userId, {
      p_job_id: jobId,
      p_card_id: cardId,
      p_child: {
        id: childId,
        first_name: input.firstName,
        last_name: input.lastName,
        group_id: group?.id ?? null,
        access_code_ciphertext: await encryptAccessCode(code, childId, keys.encryption),
      },
    }),
  );

  // The claim moved the round of the card's batches on (code review M2): tag them again now, so the review is clean
  // (Mark reviewed) without waiting for the daily sweep. Never fails the claim.
  await tagDueBatchesOfJob(supabase, studio.region, studio.id, jobId);

  // Read back as the signed-in person, through row-level security.
  const row = check(
    await supabase
      .from("children")
      .select(CHILD_COLUMNS)
      .eq("studio_id", studio.id)
      .eq("id", childId)
      .single(),
  ) as ChildRow;
  const roster = await loadRoster(supabase, studio.id, jobId);
  const child = await toChild(
    { ...row, group_name: group?.name ?? null, duplicate: isDuplicate(roster.children, childId) },
    keys,
  );
  return NextResponse.json({ child }, { status: 201 });
});
