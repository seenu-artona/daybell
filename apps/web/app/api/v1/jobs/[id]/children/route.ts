import { childInput, type RosterChild, rosterQuery } from "@daybell/api";
import { canSeeOrders } from "@daybell/core";
import { NextResponse } from "next/server";
import { accessCodeCryptoKeys, newAccessCode } from "@/lib/access-codes";
import { check, handle, parseBody, parseQuery } from "@/lib/api";
import { page } from "@/lib/jobs";
import { assertFunctionRegion } from "@/lib/region-guard";
import {
  addChildWithRetries,
  assertClassInJob,
  CHILD_COLUMNS,
  type ChildRow,
  childColumns,
  isDuplicate,
  loadRoster,
  loadRosterJob,
  pathId,
  toChild,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";
import { codeWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
// The roster carries order data since D147: Canadian studios' rosters are read in Montréal (D113), like their orders.
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/children — the roster, by last and first name, in pages. Read through the list_children RPC so
 * names never appear in a URL; the cursor and filter are IDs (D96). Each child has their photo count and, for people
 * who see orders, whether a paid order has a line for them (D147; null for photographers, here and in the database),
 * and the photo groups they are in (D156).
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { limit, cursor, classId } = parseQuery(request, rosterQuery);
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  await loadRosterJob(supabase, studio.id, jobId);
  const list = check(
    await supabase.rpc("list_children", {
      p_job_id: jobId,
      // Classes are job_groups in the database (ADR 0030's naming map).
      p_group_id: classId && classId !== "none" ? classId : null,
      p_after: cursor ?? null,
      p_limit: limit + 1,
      p_no_group: classId === "none",
    }),
  ) as { children: ChildRow[]; total: number; duplicates: number };
  const { items, nextCursor } = page(list.children, limit);
  const keys = await accessCodeCryptoKeys();
  const seesOrders = canSeeOrders(studio.role);
  const children: RosterChild[] = await Promise.all(
    items.map(async (row) => ({
      ...(await toChild(row, keys)),
      photoCount: row.photo_count ?? 0,
      hasPaidOrder: seesOrders ? (row.has_paid_order ?? null) : null,
      groups: row.photo_groups ?? [],
    })),
  );
  return NextResponse.json({
    children,
    nextCursor,
    total: list.total,
    duplicates: list.duplicates,
  });
});

/**
 * POST /api/v1/jobs/:id/children — owners, admins and photographers add a child. The server generates the access code
 * (CSPRNG), stores its hash and an encrypted copy through add_child (server-only, ADR 0011), and tries a new code if one
 * were ever taken.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  // Who and what role first: nobody else gets as far as reading the body (S4).
  const { supabase, studio, userId } = await studioScope();
  // Canadian rosters are written in Montréal, like they are read (D113).
  assertFunctionRegion(studio.region);
  assertCanEditRoster(studio);
  const input = await parseBody(request, childInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const klass = await assertClassInJob(supabase, studio.id, jobId, input.classId);
  const keys = await accessCodeCryptoKeys();
  let id = "";
  check(
    await addChildWithRetries(async () => {
      id = crypto.randomUUID();
      const code = await newAccessCode(studio.region, id, keys);
      return codeWriteRpc(studio.region, "add_child", userId, {
        p_job_id: jobId,
        p_child: {
          id,
          ...childColumns(input),
          access_code_hash: code.hash,
          access_code_ciphertext: code.ciphertext,
        },
      });
    }),
  );
  // Read back as the signed-in person, through row-level security.
  const row = check(
    await supabase
      .from("children")
      .select(CHILD_COLUMNS)
      .eq("studio_id", studio.id)
      .eq("id", id)
      .single(),
  ) as ChildRow;
  const roster = await loadRoster(supabase, studio.id, jobId);
  const child = await toChild(
    { ...row, group_name: klass?.name ?? null, duplicate: isDuplicate(roster.children, id) },
    keys,
  );
  return NextResponse.json({ child }, { status: 201 });
});
