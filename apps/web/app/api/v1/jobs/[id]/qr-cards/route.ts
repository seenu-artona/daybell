import { ApiError, QR_CARD_HEADERS, type QrCardStatus, qrCardsInput } from "@daybell/api";
import { shopUrl } from "@daybell/config";
import { groupLabel, type JobType, shopLinkText } from "@daybell/core";
import { NextResponse } from "next/server";
import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE } from "@/i18n/request";
import { accessCodeCryptoKeys, newCardAccessCode } from "@/lib/access-codes";
import { check, handle, parseBody } from "@/lib/api";
import {
  blankCardMaker,
  CODES_UNREADABLE,
  DO_NOT_PHOTOGRAPH,
  loadCardChildren,
  pdfFilename,
  prepareArgs,
  prepareWithRetries,
  printCards,
} from "@/lib/qr-cards";
import { loadFonts, renderQrCardsPdf } from "@/lib/qr-cards-pdf";
import { assertFunctionRegion } from "@/lib/region-guard";
import { loadClasses, loadRosterJob, pathId } from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";
import { codeWriteRpc } from "@/lib/supabase/service";
import messages from "@/messages/en-US.json";

// pdfkit needs Node (fs, zlib), not the edge runtime. A 5,000-child job's PDF is built in memory well within 60 s.
export const runtime = "nodejs";
export const maxDuration = 60;
// Canadian studios' cards are built in Montréal (D113; ADR 0015). assertFunctionRegion refuses any other region.
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/qr-cards — how many children who may be photographed have a card, for the Overview's Print QR
 * cards checklist task (Seenu, answer 2). Counts only; row-level security keeps it to the caller's studio.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  await loadRosterJob(supabase, studio.id, jobId);
  const status = check(await supabase.rpc("qr_card_status", { p_job_id: jobId })) as {
    eligible: number;
    with_card: number;
    blank_cards: number;
  };
  const qrCards: QrCardStatus = {
    eligible: status.eligible,
    withCard: status.with_card,
    blankCards: status.blank_cards,
  };
  return NextResponse.json({ qrCards });
});

/**
 * POST /api/v1/jobs/:id/qr-cards — the QR card PDF (D32, D138; ADR 0015). Owners, admins and photographers (Seenu,
 * answer 3). The body holds only IDs and a count. Cards are made in the database through prepare_qr_cards (server
 * only: blank cards carry pre-made codes), then the PDF is built in memory in the studio's region and sent; it is
 * never stored, and a reprint builds it again. Response headers give counts so the dialog can warn.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  // Who and what role first: nobody else gets as far as reading the body (S4).
  const { supabase, studio, userId } = await studioScope();
  assertCanEditRoster(studio);
  // Only where the studio's data may be processed, before the body is read or anything decrypted (D113).
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, qrCardsInput);

  const job = check(
    await supabase
      .from("jobs")
      .select("id, type, internal_number")
      .eq("studio_id", studio.id)
      .eq("id", jobId)
      .maybeSingle(),
  ) as { id: string; type: JobType; internal_number: string } | null;
  if (!job) throw new ApiError("not_found", "Job not found.");

  if (input.childId) {
    const child = check(
      await supabase
        .from("children")
        .select("id, do_not_photograph")
        .eq("studio_id", studio.id)
        .eq("job_id", jobId)
        .eq("id", input.childId)
        .maybeSingle(),
    ) as { id: string; do_not_photograph: boolean } | null;
    if (!child) throw new ApiError("not_found", "Child not found.");
    if (child.do_not_photograph) throw DO_NOT_PHOTOGRAPH;
  }
  const classes = await loadClasses(supabase, studio.id, jobId);
  const known = new Set(classes.map((g) => g.id));
  if (input.classIds?.some((id) => id !== "none" && !known.has(id)))
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      classIds: "validation.class",
    });

  // Settings and fonts first: a misconfiguration fails before any blank card is made or a print is recorded.
  let link: string;
  try {
    link = shopLinkText(shopUrl());
  } catch {
    // The variable's name only, never its value.
    console.error("shop_url_invalid");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  try {
    loadFonts();
  } catch {
    console.error("qr_card_fonts_missing");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  const keys = await accessCodeCryptoKeys();

  const { prepared, blanks } = await prepareWithRetries(
    blankCardMaker(input.blankCards, (cardId) => newCardAccessCode(studio.region, cardId, keys)),
    (blanks) =>
      codeWriteRpc(studio.region, "prepare_qr_cards", userId, prepareArgs(jobId, input, blanks)),
  );
  const children = await loadCardChildren(
    supabase,
    studio.id,
    jobId,
    prepared.cards.map((c) => c.child_id),
  );
  const { cards, skipped } = await printCards({ prepared, blanks, children, classes, keys });
  if (cards.length === 0)
    // Every card's code is unreadable: say why, and how many (counts only).
    return NextResponse.json(CODES_UNREADABLE.toBody(), {
      status: CODES_UNREADABLE.status,
      headers: { [QR_CARD_HEADERS.skipped]: String(skipped) },
    });

  const t = createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: "pdf.qrCards" });
  const group = groupLabel(job.type);
  let rendered: Awaited<ReturnType<typeof renderQrCardsPdf>>;
  try {
    rendered = await renderQrCardsPdf(cards, {
      title: t("title"),
      studioName: studio.name,
      groupLine: (name) => t("groupLine", { group, name }),
      groupLabel: t("groupLabel", { group }),
      nameLabel: t("nameLabel"),
      accessCodeLabel: t("accessCode"),
      instructions: t("instructions", { link }),
      blankCard: t("blankCard"),
    });
  } catch {
    // The job's id only: never names, codes or the error's text, which could quote them (D96).
    console.error("qr_cards_failed", jobId);
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }

  return new Response(new Uint8Array(rendered.pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pdfFilename(job.internal_number)}"`,
      "cache-control": "no-store",
      [QR_CARD_HEADERS.cards]: String(cards.length),
      [QR_CARD_HEADERS.skipped]: String(skipped),
      [QR_CARD_HEADERS.replaced]: String(rendered.replacedCards),
    },
  });
});
