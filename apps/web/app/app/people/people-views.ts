import type { ListFilterChip } from "@daybell/api";

/**
 * People's chips (D150, D147; ADR 0028). One chip at a time, in the address as enum words and ids only (D113): search
 * text never goes there, and is sent in a POST body.
 * - Contacts: All and Main contacts built in (?show=main); a client added by the person (?client=<id>).
 * - Subjects: All, then Ordered and Not ordered for people who see orders (?show=ordered|notOrdered, D148); a job or
 *   a client added by the person (?job=<id>, ?client=<id>).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request to the API: a GET, or a POST with the search text in its body. */
export type ListRequest = { path: string; body?: Record<string, unknown> };

// ── Contacts ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const CONTACTS_BASE = "/app/people/contacts";

export type ContactChip = { kind: "all" } | { kind: "main" } | { kind: "client"; id: string };

export const ALL_CONTACTS: ContactChip = { kind: "all" };
export const BUILT_IN_CONTACT_CHIPS: readonly ContactChip[] = [ALL_CONTACTS, { kind: "main" }];

/** The chip in the address. Anything unknown, or two at once, is All, and `clean` says to replace the address. */
export function contactChipFrom(params: URLSearchParams): { chip: ContactChip; clean: boolean } {
  const show = params.get("show");
  const client = params.get("client");
  const others = [...params.keys()].some((k) => k !== "show" && k !== "client");
  if (show === null && client === null) return { chip: ALL_CONTACTS, clean: others };
  if (!others && show === "main" && client === null)
    return { chip: { kind: "main" }, clean: false };
  if (!others && show === null && client !== null && UUID.test(client))
    return { chip: { kind: "client", id: client.toLowerCase() }, clean: false };
  return { chip: ALL_CONTACTS, clean: true };
}

export function contactChipHref(chip: ContactChip): string {
  if (chip.kind === "main") return `${CONTACTS_BASE}?show=main`;
  if (chip.kind === "client") return `${CONTACTS_BASE}?client=${chip.id}`;
  return CONTACTS_BASE;
}

export function sameContactChip(a: ContactChip, b: ContactChip): boolean {
  return contactChipHref(a) === contactChipHref(b);
}

/** A saved chip's filter, or null for a key Contacts doesn't take. */
export function contactChipFromSaved(saved: ListFilterChip): ContactChip | null {
  return saved.key === "client" && saved.value ? { kind: "client", id: saved.value } : null;
}

/** GET /contacts for a chip and page, or POST /contacts/search with the text in the body. */
export function contactsRequest(
  chip: ContactChip,
  cursor: string | null,
  search: string,
): ListRequest {
  const filters: Record<string, string> = {};
  if (chip.kind === "main") filters.show = "main";
  if (chip.kind === "client") filters.clientId = chip.id;
  if (cursor) filters.cursor = cursor;
  if (search) return { path: "/contacts/search", body: { ...filters, q: search } };
  const query = new URLSearchParams(filters).toString();
  return { path: query ? `/contacts?${query}` : "/contacts" };
}

// ── Subjects ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const SUBJECTS_BASE = "/app/people/subjects";

export const SUBJECT_ORDER_SHOWS = ["ordered", "notOrdered"] as const;
export type SubjectOrderShow = (typeof SUBJECT_ORDER_SHOWS)[number];

export type PeopleSubjectChip =
  | { kind: "all" }
  | { kind: "show"; show: SubjectOrderShow }
  | { kind: "job"; id: string }
  | { kind: "client"; id: string };

export const ALL_SUBJECTS: PeopleSubjectChip = { kind: "all" };

/** All, then Ordered and Not ordered for people who see orders (photographers get neither, answer 4). */
export function builtInSubjectChips(seesOrders: boolean): readonly PeopleSubjectChip[] {
  return [
    ALL_SUBJECTS,
    ...(seesOrders ? SUBJECT_ORDER_SHOWS.map((show) => ({ kind: "show", show }) as const) : []),
  ];
}

/**
 * The chip in the address. An order chip needs order data (`seesOrders`). Anything unknown, two at once, or an order
 * chip for someone who doesn't see orders is All, and `clean` says to replace the address.
 */
export function peopleSubjectChipFrom(
  params: URLSearchParams,
  { seesOrders }: { seesOrders: boolean },
): { chip: PeopleSubjectChip; clean: boolean } {
  const keys = [...new Set(params.keys())];
  if (keys.length === 0) return { chip: ALL_SUBJECTS, clean: false };
  if (keys.length === 1) {
    const value = params.get(keys[0] ?? "") ?? "";
    if (
      keys[0] === "show" &&
      seesOrders &&
      (SUBJECT_ORDER_SHOWS as readonly string[]).includes(value)
    )
      return { chip: { kind: "show", show: value as SubjectOrderShow }, clean: false };
    if ((keys[0] === "job" || keys[0] === "client") && UUID.test(value))
      return { chip: { kind: keys[0], id: value.toLowerCase() }, clean: false };
  }
  return { chip: ALL_SUBJECTS, clean: true };
}

export function peopleSubjectChipHref(chip: PeopleSubjectChip): string {
  switch (chip.kind) {
    case "all":
      return SUBJECTS_BASE;
    case "show":
      return `${SUBJECTS_BASE}?show=${chip.show}`;
    case "job":
      return `${SUBJECTS_BASE}?job=${chip.id}`;
    case "client":
      return `${SUBJECTS_BASE}?client=${chip.id}`;
  }
}

export function samePeopleSubjectChip(a: PeopleSubjectChip, b: PeopleSubjectChip): boolean {
  return peopleSubjectChipHref(a) === peopleSubjectChipHref(b);
}

/** A saved chip's filter, or null for a key Subjects doesn't take. */
export function peopleSubjectChipFromSaved(saved: ListFilterChip): PeopleSubjectChip | null {
  if (!saved.value) return null;
  if (saved.key === "job") return { kind: "job", id: saved.value };
  if (saved.key === "client") return { kind: "client", id: saved.value };
  return null;
}

/** GET /subjects for a chip and page, or POST /subjects/search with the name in the body. */
export function subjectsRequest(
  chip: PeopleSubjectChip,
  cursor: string | null,
  search: string,
): ListRequest {
  const filters: Record<string, string> = {};
  if (chip.kind === "show") filters.show = chip.show;
  if (chip.kind === "job") filters.jobId = chip.id;
  if (chip.kind === "client") filters.clientId = chip.id;
  if (cursor) filters.cursor = cursor;
  if (search) return { path: "/subjects/search", body: { ...filters, q: search } };
  const query = new URLSearchParams(filters).toString();
  return { path: query ? `/subjects?${query}` : "/subjects" };
}

/**
 * A child's own place: their job's Subjects tab with them open in the floating panel (the existing deep link, D144:
 * ?child=<id>, an id only).
 */
export function childHref(subject: { id: string; job: { id: string } }): string {
  return `/app/jobs/${subject.job.id}/people?child=${subject.id}`;
}
