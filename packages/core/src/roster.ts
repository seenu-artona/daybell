/**
 * The roster (Phase 1 step 2, ADR 0011; D23, F13): who may edit it, how a roster file's columns are guessed, how rows
 * are built, which children are duplicates, and how a file is matched to the roster already in a job. Pure functions,
 * shared by the import screen and the API. The SQL in list_children uses the same duplicate rule.
 */

export const ROSTER_EDITOR_ROLES = ["owner", "admin", "photographer"] as const;

/** Owners, admins and photographers add, import and edit children; staff only read (Seenu, Oct 11 2026). */
export function canEditRoster(role: string): boolean {
  return (ROSTER_EDITOR_ROLES as readonly string[]).includes(role);
}

/** Largest file the import accepts; larger rosters are split into several imports. */
export const ROSTER_MAX_ROWS = 5000;

export const ROSTER_TARGETS = [
  "firstName",
  "lastName",
  "class",
  "studentId",
  "grade",
  "parentEmail",
  "doNotPhotograph",
  "doNotPublish",
] as const;
export type RosterTarget = (typeof ROSTER_TARGETS)[number];

/** Header names each target is guessed from, after normalizeHeader. Earlier targets, then earlier synonyms, win. */
export const ROSTER_SYNONYMS: Record<RosterTarget, readonly string[]> = {
  firstName: [
    "first name",
    "firstname",
    "first",
    "given name",
    "student first name",
    "child first name",
    "legal first name",
    "preferred first name",
    "fname",
  ],
  lastName: [
    "last name",
    "lastname",
    "last",
    "surname",
    "family name",
    "student last name",
    "child last name",
    "legal last name",
    "lname",
  ],
  class: [
    "class",
    "class name",
    "classroom",
    "homeroom",
    "homeroom teacher",
    "teacher",
    "room",
    "section",
    "team",
    "team name",
    "group",
    "group name",
  ],
  studentId: [
    "student id",
    "studentid",
    "student number",
    "student no",
    "student id number",
    "id",
    "sis id",
    "pupil id",
    "local id",
  ],
  grade: ["grade", "grade level", "gr", "grd", "level", "year"],
  parentEmail: [
    "parent email",
    "guardian email",
    "parent guardian email",
    "family email",
    "contact email",
    "primary email",
    "email",
    "e mail",
    "email address",
  ],
  doNotPhotograph: [
    "do not photograph",
    "dnp",
    "no photo",
    "no photos",
    "photo opt out",
    "opt out",
  ],
  doNotPublish: ["do not publish", "no publish", "publish opt out", "media opt out", "no online"],
};

/** "Student #" -> "student number", "Parent/Guardian E-mail" -> "parent guardian e mail". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/#/g, " number ")
    .replace(/\bno\./g, " number ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * For each column (by index), what it most likely holds, or null for "Don't import". `classLabel`, the job's own name
 * for the class field (ADR 0030, call 29: e.g. Homeroom or Section), is the class column's first synonym.
 */
export function guessColumns(
  headers: readonly string[],
  classLabel?: string,
): Record<number, RosterTarget | null> {
  const normalized = headers.map(normalizeHeader);
  const out: Record<number, RosterTarget | null> = {};
  for (let i = 0; i < headers.length; i++) out[i] = null;
  const own = classLabel ? normalizeHeader(classLabel) : "";
  for (const target of ROSTER_TARGETS) {
    const synonyms =
      target === "class" && own !== "" ? [own, ...ROSTER_SYNONYMS.class] : ROSTER_SYNONYMS[target];
    for (const synonym of synonyms) {
      const column = normalized.findIndex((h, i) => h === synonym && out[i] === null);
      if (column >= 0) {
        out[column] = target;
        break;
      }
    }
  }
  return out;
}

const NO = new Set(["", "no", "n", "false", "0", "-"]);

/** An opt-out cell. Anything other than a clear "no" means yes: "Parent request" opts the child out (privacy first). */
export function parseYesNo(cell: string): boolean {
  return !NO.has(cell.trim().toLowerCase());
}

/** One file row as the import will send it; checked later with the API's rosterRow schema. */
export interface RosterRowDraft {
  firstName: string;
  lastName: string;
  /** The class's name (C6: the API calls it class). */
  class: string | null;
  studentId: string | null;
  grade: string | null;
  parentEmail: string | null;
  /** null when no column was mapped to it. */
  doNotPhotograph: boolean | null;
  doNotPublish: boolean | null;
}

const clean = (cell: string | undefined) => (cell ?? "").replace(/\s+/g, " ").trim();

/** Turns data rows (header excluded) into drafts using the confirmed column mapping. */
export function buildRows(
  rows: readonly (readonly string[])[],
  mapping: Record<number, RosterTarget | null>,
): RosterRowDraft[] {
  const columnOf = (target: RosterTarget): number | null => {
    for (const [i, t] of Object.entries(mapping)) if (t === target) return Number(i);
    return null;
  };
  const columns = Object.fromEntries(ROSTER_TARGETS.map((t) => [t, columnOf(t)])) as Record<
    RosterTarget,
    number | null
  >;
  const text = (row: readonly string[], target: RosterTarget) => {
    const i = columns[target];
    return i === null ? "" : clean(row[i]);
  };
  const optional = (row: readonly string[], target: RosterTarget) => text(row, target) || null;
  const flag = (row: readonly string[], target: RosterTarget) =>
    columns[target] === null ? null : parseYesNo(text(row, target));
  return rows.map((row) => ({
    firstName: text(row, "firstName"),
    lastName: text(row, "lastName"),
    class: optional(row, "class"),
    studentId: optional(row, "studentId"),
    grade: optional(row, "grade"),
    parentEmail: optional(row, "parentEmail")?.toLowerCase() ?? null,
    doNotPhotograph: flag(row, "doNotPhotograph"),
    doNotPublish: flag(row, "doNotPublish"),
  }));
}

export interface DuplicateEntry {
  firstName: string;
  lastName: string;
  studentId: string | null;
  /** The class (or team) name; null for none. */
  class: string | null;
}

const squash = (s: string) => s.replace(/\s/g, "").toLowerCase();
const classKey = (s: string | null) =>
  s?.trim() ? s.replace(/\s+/g, " ").trim().toLowerCase() : null;

/**
 * Children with the same key are duplicates (Seenu, Oct 11 2026): the same student ID (case and whitespace ignored);
 * or, when there is no student ID, the same first and last name (case and whitespace ignored) in the same class. "No
 * class" counts as a class. A child with an ID and one without are never duplicates.
 */
export function duplicateKey(entry: DuplicateEntry): string {
  if (entry.studentId?.trim()) return `id:${squash(entry.studentId)}`;
  // A NUL separates the class from the names, so no class name can run into them.
  return `name:${classKey(entry.class) ?? "-"}\u0000${squash(entry.firstName)}|${squash(entry.lastName)}`;
}

/** Indexes of entries that share a duplicate key with another entry. */
export function findDuplicates(entries: readonly DuplicateEntry[]): Set<number> {
  const byKey = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const key = duplicateKey(e);
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  });
  const out = new Set<number>();
  for (const indexes of byKey.values()) if (indexes.length > 1) for (const i of indexes) out.add(i);
  return out;
}

export interface ExistingChild {
  id: string;
  studentId: string | null;
  firstName: string;
  lastName: string;
  className: string | null;
}

export type RosterAction = { kind: "add" } | { kind: "update"; id: string };

export interface RosterPlan {
  actions: RosterAction[];
  /** Per file row: whether it duplicates another row or a child already on the roster. */
  duplicate: boolean[];
}

/**
 * How a file lands on a job's roster (Seenu, Oct 11 2026). In file order, a row with a student ID updates the existing
 * child only if exactly one child has that ID and no earlier row matched it; every other row is added. Children not
 * in the file are left alone. Duplicates are found over the roster as it will be: existing children (with updates
 * applied: names replaced, the class only when the row has one) plus the added rows.
 */
export function planRosterImport(
  existing: readonly ExistingChild[],
  rows: readonly RosterRowDraft[],
): RosterPlan {
  const byStudentId = new Map<string, ExistingChild[]>();
  for (const child of existing) {
    if (!child.studentId?.trim()) continue;
    const key = squash(child.studentId);
    byStudentId.set(key, [...(byStudentId.get(key) ?? []), child]);
  }
  const matched = new Map<string, number>();
  const actions: RosterAction[] = rows.map((row, i) => {
    if (!row.studentId?.trim()) return { kind: "add" };
    const candidates = byStudentId.get(squash(row.studentId)) ?? [];
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (!only || matched.has(only.id)) return { kind: "add" };
    matched.set(only.id, i);
    return { kind: "update", id: only.id };
  });

  // The roster as it will be: file rows first (so their indexes line up), then untouched existing children.
  const entries: DuplicateEntry[] = rows.map((row, i) => {
    const action = actions[i];
    if (action?.kind !== "update") return row;
    const child = existing.find((c) => c.id === action.id) as ExistingChild;
    return {
      firstName: row.firstName,
      lastName: row.lastName,
      studentId: child.studentId,
      class: row.class ?? child.className,
    };
  });
  for (const child of existing) {
    if (!matched.has(child.id)) {
      entries.push({
        firstName: child.firstName,
        lastName: child.lastName,
        studentId: child.studentId,
        class: child.className,
      });
    }
  }
  const duplicates = findDuplicates(entries);
  return { actions, duplicate: rows.map((_, i) => duplicates.has(i)) };
}

/** How many classes the rows name that the job doesn't have yet (names compared ignoring case and extra spaces). */
export function countNewClasses(
  existingNames: readonly string[],
  rows: readonly { class: string | null }[],
): number {
  const known = new Set(existingNames.map((n) => classKey(n)));
  const fresh = new Set<string>();
  for (const row of rows) {
    const key = classKey(row.class);
    if (key && !known.has(key)) fresh.add(key);
  }
  return fresh.size;
}
