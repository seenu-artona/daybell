/**
 * The job's People section (D137, D138; ADR 0013): search, filters and grouping over the loaded roster. Pure
 * functions over the few fields they need, so they work on the API's Child without importing it. The search text and
 * the filters stay in the browser: they may hold names, so they are never sent anywhere or put in URLs (ADR 0011).
 */

/** The People list loads at most this many children (the import cap); search and filters cover only those. */
export const ROSTER_VIEW_MAX = 5000;

export interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  studentId: string | null;
  grade: string | null;
  accessCode: string | null;
  /** Their class (a roster field; C1, ADR 0030). */
  class: { id: string; name: string } | null;
  /** The photo groups they are in (D156); left out where the list doesn't have them. */
  groups?: readonly { id: string; name: string }[];
  doNotPhotograph: boolean;
  doNotPublish: boolean;
  duplicate: boolean;
  /** Ready photos tagged to the child, outside the bin (D147); left out where the list doesn't have it. */
  photoCount?: number;
  /** Whether a paid order has a line for the child; null for people who don't see orders (D147). */
  hasPaidOrder?: boolean | null;
}

/** Lower case, accents removed, runs of whitespace as one space. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const compact = (text: string) => text.replace(/[\s-]/g, "").toUpperCase();

/** Codes are 8 symbols; shorter fragments would match too many codes by chance. */
const MIN_CODE_QUERY = 4;

/**
 * Does a child match the search box? Case and accents are ignored. Matches "first last", "last first" (a comma
 * is allowed: "Chen, Liam"), the student ID, and, from 4 symbols, the access code with dashes and spaces ignored.
 */
export function matchesSearch(row: PersonRow, query: string): boolean {
  const q = fold(query.replace(/,/g, " "));
  if (!q) return true;
  const first = fold(row.firstName);
  const last = fold(row.lastName);
  if (`${first} ${last}`.includes(q) || `${last} ${first}`.includes(q)) return true;
  if (row.studentId && fold(row.studentId).includes(q)) return true;
  const code = compact(query);
  return (
    code.length >= MIN_CODE_QUERY &&
    row.accessCode !== null &&
    compact(row.accessCode).includes(code)
  );
}

export type PeopleFilter =
  | { kind: "class"; id: string }
  | { kind: "noClass" }
  /** A photo group (D156): its members. */
  | { kind: "group"; id: string }
  | { kind: "grade"; value: string }
  | { kind: "doNotPhotograph" }
  | { kind: "doNotPublish" }
  | { kind: "duplicates" }
  | { kind: "notOrdered" }
  | { kind: "noPhotos" }
  | { kind: "notPhotographed" };
export type PeopleFilterKind = PeopleFilter["kind"];

/** The two class filters exclude each other: a child is either in a class or in none. */
const EXCLUDES: Partial<Record<PeopleFilterKind, PeopleFilterKind>> = {
  class: "noClass",
  noClass: "class",
};

/** Adds a filter. Each kind holds one value, so a new one replaces the old; class and noClass replace each other. */
export function addFilter(filters: readonly PeopleFilter[], next: PeopleFilter): PeopleFilter[] {
  const drop = new Set<PeopleFilterKind>([next.kind]);
  const other = EXCLUDES[next.kind];
  if (other) drop.add(other);
  return [...filters.filter((f) => !drop.has(f.kind)), next];
}

export function removeFilter(
  filters: readonly PeopleFilter[],
  kind: PeopleFilterKind,
): PeopleFilter[] {
  return filters.filter((f) => f.kind !== kind);
}

function passes(row: PersonRow, filter: PeopleFilter): boolean {
  switch (filter.kind) {
    case "class":
      return row.class?.id === filter.id;
    case "noClass":
      return row.class === null;
    // People in no group, or whose groups the list doesn't have, never match.
    case "group":
      return row.groups?.some((g) => g.id === filter.id) ?? false;
    case "grade":
      return row.grade !== null && fold(row.grade) === fold(filter.value);
    case "doNotPhotograph":
      return row.doNotPhotograph;
    case "doNotPublish":
      return row.doNotPublish;
    case "duplicates":
      return row.duplicate;
    // Only children known to have no paid order: unknown (null, not shown to this person) never matches.
    case "notOrdered":
      return row.hasPaidOrder === false;
    case "noPhotos":
      return row.photoCount === 0;
    // D153: no photos, and not someone who mustn't be photographed (they are never "missing").
    case "notPhotographed":
      return row.photoCount === 0 && !row.doNotPhotograph;
  }
}

/** Keeps the rows that pass every filter (different kinds combine with AND). */
export function applyFilters<R extends PersonRow>(
  rows: readonly R[],
  filters: readonly PeopleFilter[],
): R[] {
  return rows.filter((row) => filters.every((f) => passes(row, f)));
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** The distinct grades on the roster, in natural order (K, 1, 2, … 10, not 1, 10, 2). */
export function gradeOptions(rows: readonly PersonRow[]): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const grade = row.grade?.trim();
    if (grade && !seen.has(fold(grade))) seen.set(fold(grade), grade);
  }
  return [...seen.values()].sort(natural.compare);
}

export interface RosterSection<R> {
  /** A class id, "none" for children without one, or "all" when not grouped. */
  key: string;
  /** The class, or null for "No class" and the ungrouped list. */
  class: { id: string; name: string } | null;
  rows: R[];
}

/**
 * Splits rows into sections by class. Classes follow the order of `classes` (the classes API, natural order), "No
 * class" comes last; rows keep their order (last name, first name). Empty classes are kept only with
 * `includeEmptyClasses` (no search or filter active), so a class can still be renamed before it has children.
 */
export function groupPeople<R extends PersonRow>(
  rows: readonly R[],
  classes: readonly { id: string; name: string }[],
  groupBy: "class" | "none",
  { includeEmptyClasses }: { includeEmptyClasses: boolean },
): RosterSection<R>[] {
  if (groupBy === "none") return [{ key: "all", class: null, rows: [...rows] }];
  const byClass = new Map<string, R[]>();
  const none: R[] = [];
  for (const row of rows) {
    if (!row.class) {
      none.push(row);
      continue;
    }
    const list = byClass.get(row.class.id);
    if (list) list.push(row);
    else byClass.set(row.class.id, [row]);
  }
  const sections: RosterSection<R>[] = [];
  const known = new Set<string>();
  for (const c of classes) {
    known.add(c.id);
    const list = byClass.get(c.id) ?? [];
    if (list.length > 0 || includeEmptyClasses)
      sections.push({ key: c.id, class: { id: c.id, name: c.name }, rows: list });
  }
  // A class the classes list didn't have (e.g. added meanwhile) still shows, after the known ones.
  for (const [id, list] of byClass) {
    const first = list[0]?.class;
    if (!known.has(id) && first)
      sections.push({ key: id, class: { id, name: first.name }, rows: list });
  }
  if (none.length > 0) sections.push({ key: "none", class: null, rows: none });
  return sections;
}

/**
 * A parent email as the Subjects person view shows it (D153; Seenu, Oct 14): the first letter of the name, dots, then
 * the domain whole, e.g. p•••@gmail.com. The full address stays in the edit form for roster editors.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}
