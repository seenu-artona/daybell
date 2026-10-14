import type { ListFilterChip } from "@daybell/api";
import type { PeopleFilter } from "@daybell/core";

/**
 * Subjects' chips (D147, amends D144 and D145): All, Not ordered (for people who see orders), No photos and Possible
 * duplicates built in; a class, No class, Do not photograph and Do not publish added by the person (saved), and a grade
 * (kept in this browser only: never saved, never in the address). One chip at a time, in the address as ?show=<word>
 * or ?class=<id>, with the open child in &child=<id> (enum words and ids only, never search text: D113).
 */
export const SUBJECT_SHOWS = [
  "notOrdered",
  "noPhotos",
  "duplicates",
  "doNotPhotograph",
  "doNotPublish",
  "noClass",
] as const;
export type SubjectShow = (typeof SUBJECT_SHOWS)[number];

/** Built in after All, in order. */
export const BUILT_IN_SHOWS = ["notOrdered", "noPhotos", "duplicates"] as const;
/** What "+ Add filter" offers beside each class and a grade. */
export const SAVED_SHOWS = ["noClass", "doNotPhotograph", "doNotPublish"] as const;

export type SubjectChip =
  | { kind: "all" }
  | { kind: "show"; show: SubjectShow }
  | { kind: "class"; id: string }
  | { kind: "grade"; grade: string };

export const ALL_SUBJECTS: SubjectChip = { kind: "all" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The chip in the address. Not ordered needs order data (`seesOrders`). Anything unknown, both parameters, or Not ordered
 * for someone who doesn't see orders, is All, and `clean` says the page should replace the address.
 */
export function subjectChipFrom(
  params: URLSearchParams,
  { seesOrders }: { seesOrders: boolean },
): { chip: SubjectChip; clean: boolean } {
  const show = params.get("show");
  const id = params.get("class");
  if (show === null && id === null) return { chip: ALL_SUBJECTS, clean: false };
  if (show !== null && id === null && (SUBJECT_SHOWS as readonly string[]).includes(show)) {
    if (show !== "notOrdered" || seesOrders)
      return { chip: { kind: "show", show: show as SubjectShow }, clean: false };
  }
  if (id !== null && show === null && UUID.test(id))
    return { chip: { kind: "class", id: id.toLowerCase() }, clean: false };
  return { chip: ALL_SUBJECTS, clean: true };
}

/** A chip's address, with the open child's id when there is one. A grade chip's is the plain list's. */
export function subjectsHref(base: string, chip: SubjectChip, childId?: string | null): string {
  const params = new URLSearchParams();
  if (chip.kind === "show") params.set("show", chip.show);
  if (chip.kind === "class") params.set("class", chip.id);
  if (childId) params.set("child", childId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function sameSubjectChip(a: SubjectChip, b: SubjectChip): boolean {
  if (a.kind === "grade" || b.kind === "grade")
    return a.kind === "grade" && b.kind === "grade" && a.grade === b.grade;
  return subjectsHref("", a) === subjectsHref("", b);
}

/** A saved chip's filter, or null for a key Subjects doesn't take. */
export function subjectChipFromSaved(saved: ListFilterChip): SubjectChip | null {
  if (saved.key === "class" && saved.value) return { kind: "class", id: saved.value };
  if ((SAVED_SHOWS as readonly string[]).includes(saved.key) && !saved.value)
    return { kind: "show", show: saved.key as SubjectShow };
  return null;
}

/** The chip as one of core's filters (the search box is applied on top). */
export function subjectFilters(chip: SubjectChip): PeopleFilter[] {
  switch (chip.kind) {
    case "all":
      return [];
    case "class":
      return [{ kind: "group", id: chip.id }];
    case "grade":
      return [{ kind: "grade", value: chip.grade }];
    case "show":
      return [chip.show === "noClass" ? { kind: "noGroup" } : { kind: chip.show }];
  }
}
