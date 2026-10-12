import "server-only";
import { ApiError, fromDatabaseError, type QrCardsInput } from "@daybell/api";
import {
  type AccessCodeCryptoKeys,
  type CardPerson,
  cardQrPayload,
  decryptAccessCode,
  formatAccessCode,
  sortCardChildren,
} from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";
import type { PrintCard } from "./qr-cards-pdf";

/**
 * Server helpers for QR cards (Phase 1 step 3, ADR 0015). Only IDs ever go in URLs or logs: names, card codes and
 * access codes stay in memory for the one request that builds the PDF (D96, D113).
 */

type DbError = { code?: string; message?: string } | null;
type RpcResult = { data: unknown; error: DbError };

/** What prepare_qr_cards returns: every card in the print's scope, and the new blank cards. */
export interface PreparedCards {
  cards: { child_id: string; card_code: string }[];
  blanks: { id: string; card_code: string }[];
  new_cards: number;
}

/** A blank card as sent to the database, with its code kept here to print. */
export interface BlankCard {
  id: string;
  code: string;
  hash: string;
  ciphertext: string;
}

/** The database's arguments for a print, from the validated request. */
export function prepareArgs(jobId: string, input: QrCardsInput, blanks: readonly BlankCard[]) {
  const groupIds = input.groupIds?.filter((id) => id !== "none") ?? null;
  return {
    p_job_id: jobId,
    p_group_ids: input.groupIds ? groupIds : null,
    p_no_group: input.groupIds?.includes("none") ?? false,
    p_child_id: input.childId ?? null,
    p_blanks: blanks.map((b) => ({
      id: b.id,
      access_code_hash: b.hash,
      access_code_ciphertext: b.ciphertext,
    })),
  };
}

/** Tries for codes, as for children (ADR 0011): a taken code or card code is astronomically rare. */
const ATTEMPTS = 3;

const RETRY = new Set(["access_code_collision", "card_code_collision"]);

/** The named failures prepare_qr_cards raises (their messages carry no values), as API errors. */
export function prepareError(error: NonNullable<DbError>): ApiError {
  if (error.code === "P0001" && error.message === "do_not_photograph")
    return new ApiError("conflict", "This child is marked Do not photograph, so they get no card.");
  if (error.code === "P0001" && error.message === "nothing_to_print")
    return new ApiError("conflict", "There are no cards to print.");
  if (error.code === "P0002") return new ApiError("not_found", "Job not found.");
  if (error.code === "22023")
    return new ApiError("invalid_input", "Please check what you chose to print.");
  return fromDatabaseError(error);
}

/**
 * Prepares a print through prepare_qr_cards with fresh blank cards on each try (`makeBlanks` makes them). A taken
 * code tries again with new ones; anything else is an error.
 */
export async function prepareWithRetries(
  makeBlanks: () => Promise<BlankCard[]>,
  send: (blanks: BlankCard[]) => PromiseLike<RpcResult>,
): Promise<{ prepared: PreparedCards; blanks: BlankCard[] }> {
  for (let tries = 1; ; tries++) {
    const blanks = await makeBlanks();
    const result = await send(blanks);
    if (!result.error) return { prepared: result.data as PreparedCards, blanks };
    if (result.error.code === "P0001" && RETRY.has(result.error.message ?? "") && tries < ATTEMPTS)
      continue;
    throw prepareError(result.error);
  }
}

/** Blank cards for one try: new ids and new codes, made with the access code keys (server only). */
export function blankCardMaker(
  count: number,
  newCode: (cardId: string) => Promise<{ code: string; hash: string; ciphertext: string }>,
): () => Promise<BlankCard[]> {
  return () =>
    Promise.all(
      Array.from({ length: count }, async () => {
        const id = crypto.randomUUID();
        return { id, ...(await newCode(id)) };
      }),
    );
}

export interface CardChildRow {
  id: string;
  group_id: string | null;
  first_name: string;
  last_name: string;
  do_not_photograph: boolean;
  access_code_ciphertext: string;
}

const PAGE = 1000; // Supabase returns at most 1,000 rows per request by default.

/** The job's children (only what a card needs), paged by id, read as the signed-in person through RLS. */
export async function loadCardChildren(
  supabase: SupabaseClient,
  studioId: string,
  jobId: string,
): Promise<CardChildRow[]> {
  const out: CardChildRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = (check(
      await supabase
        .from("children")
        .select("id, group_id, first_name, last_name, do_not_photograph, access_code_ciphertext")
        .eq("studio_id", studioId)
        .eq("job_id", jobId)
        .order("id")
        .range(from, from + PAGE - 1),
    ) ?? []) as CardChildRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * The cards to print, in order (D138): children's cards sorted by class, then the blank cards. A child whose access
 * code can't be read is left out and counted (Seenu, answer 9): a card is never printed without a working code. Only
 * the child's id is logged, as everywhere else (ADR 0011).
 */
export async function printCards(options: {
  prepared: PreparedCards;
  blanks: readonly BlankCard[];
  children: readonly CardChildRow[];
  groups: readonly { id: string; name: string }[];
  keys: AccessCodeCryptoKeys;
}): Promise<{ cards: PrintCard[]; skipped: number }> {
  const groupNames = new Map(options.groups.map((g) => [g.id, g.name]));
  const rows = new Map(options.children.map((c) => [c.id, c]));
  const cardCodes = new Map(options.prepared.cards.map((c) => [c.child_id, c.card_code]));
  const people: (CardPerson & { row: CardChildRow })[] = [];
  for (const childId of cardCodes.keys()) {
    const row = rows.get(childId);
    if (!row) continue;
    const groupName = row.group_id ? groupNames.get(row.group_id) : undefined;
    people.push({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      group: row.group_id && groupName !== undefined ? { id: row.group_id, name: groupName } : null,
      doNotPhotograph: row.do_not_photograph,
      row,
    });
  }

  let skipped = 0;
  const cards: PrintCard[] = [];
  for (const person of sortCardChildren(people)) {
    let code: string;
    try {
      code = await decryptAccessCode(
        person.row.access_code_ciphertext,
        person.id,
        options.keys.encryption,
      );
    } catch {
      console.error("access_code_unreadable", person.id);
      skipped++;
      continue;
    }
    cards.push({
      child: {
        firstName: person.firstName,
        lastName: person.lastName,
        group: person.group?.name ?? null,
      },
      qrPayload: cardQrPayload(cardCodes.get(person.id) as string),
      accessCode: formatAccessCode(code),
    });
  }

  const blankCodes = new Map(options.prepared.blanks.map((b) => [b.id, b.card_code]));
  for (const blank of options.blanks) {
    const cardCode = blankCodes.get(blank.id);
    if (!cardCode) continue;
    cards.push({
      child: null,
      qrPayload: cardQrPayload(cardCode),
      accessCode: formatAccessCode(blank.code),
    });
  }
  return { cards, skipped };
}

/** A download name from the job's internal number: only letters, digits, "-" and "_" (no names, D96). */
export function pdfFilename(internalNumber: string): string {
  const safe = internalNumber.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `qr-cards${safe ? `-${safe}` : ""}.pdf`;
}
