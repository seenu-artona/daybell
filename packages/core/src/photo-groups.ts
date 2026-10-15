/**
 * Photos' groups (D156; Seenu's answers of Oct 14, 2026; ADR 0030). A group is people (members) plus its group photos;
 * a person can be in several groups and a group photo shown in several. Groups are made by hand or once from a roster
 * column (a shortcut, not a switch), and nothing changes a group's photos or members by itself. Pure rules shared by
 * the API and the screens; the database enforces the same.
 */

/** At most this many groups per job (C10). */
export const MAX_PHOTO_GROUPS = 500;
/** A group's name: 1 to 60 characters, trimmed (C10). */
export const MAX_GROUP_NAME = 60;
/** Ids per change: members added or removed, photos moved or shown, groups shown in (C10). */
export const MAX_GROUP_CHANGE = 500;
/** People per page of Photos' People view (D156: 50 at a time). */
export const PEOPLE_PAGE_SIZE = 50;
/** Photos in a person's line before Show all (card photos included, the first card photo first). */
export const PERSON_STRIP_PHOTOS = 12;

/**
 * The roster columns groups can be made from (C3: any roster column; ADR 0030, call 9): the class (a team or group on
 * other job types), grade, first name, last name and student ID. The roster has no Teacher or custom columns yet. Parent
 * email and the yes/no flags are left out (call 9: an email would show unmasked as a group's name; a flag has no value
 * to name a group by).
 */
export const GROUP_COLUMNS = ["class", "grade", "firstName", "lastName", "studentId"] as const;
export type GroupColumn = (typeof GROUP_COLUMNS)[number];

/** Where a deleted group's photos go (C4): another group, or the bin. */
export const GROUP_PHOTOS_TO = ["group", "bin"] as const;
export type GroupPhotosTo = (typeof GROUP_PHOTOS_TO)[number];

/** An upload is individual photos (split by QR card) or group photos for one group (D156). */
export const UPLOAD_KINDS = ["individual", "group"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

const fold = (name: string) => name.trim().toLowerCase();

/** A name as typed, with runs of spaces made one and the ends trimmed. */
export function cleanGroupName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export type GroupNameProblem = "empty" | "tooLong" | "taken";

/**
 * Why a name can't be a group's (C10): empty, over 60 characters, or another group of the job already has it,
 * ignoring case. `exceptId` is the group being renamed. Null when the name is fine. Check a cleaned name.
 */
export function groupNameProblem(
  name: string,
  groups: readonly { id: string; name: string }[],
  exceptId: string | null = null,
): GroupNameProblem | null {
  if (name === "") return "empty";
  if (name.length > MAX_GROUP_NAME) return "tooLong";
  const key = fold(name);
  return groups.some((g) => g.id !== exceptId && fold(g.name) === key) ? "taken" : null;
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Groups by name in natural order ("Room 2" before "Room 10"), then id so the order never changes. */
export function sortPhotoGroups<T extends { id: string; name: string }>(groups: readonly T[]): T[] {
  return [...groups].sort(
    (a, b) => natural.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** What Add or remove people sends: who joins and who leaves, from the members before and the boxes ticked now. */
export function membersChange(
  before: ReadonlySet<string>,
  chosen: ReadonlySet<string>,
): { add: string[]; remove: string[] } {
  return {
    add: [...chosen].filter((id) => !before.has(id)).sort(),
    remove: [...before].filter((id) => !chosen.has(id)).sort(),
  };
}

/** Splits ids into requests of at most `size` (500 per change, C10). */
export function chunk<T>(items: readonly T[], size = MAX_GROUP_CHANGE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The adds and removes of one members change, sent as requests of at most 500 ids each way (a request may carry both
 * lists). Empty when nothing changed.
 */
export function membersRequests(change: {
  add: readonly string[];
  remove: readonly string[];
}): { add: string[]; remove: string[] }[] {
  const adds = chunk(change.add);
  const removes = chunk(change.remove);
  return Array.from({ length: Math.max(adds.length, removes.length) }, (_, i) => ({
    add: adds[i] ?? [],
    remove: removes[i] ?? [],
  }));
}

/** A group with photos needs a destination for them before it is deleted (ADR 0030, call 3); an empty one doesn't. */
export function deleteNeedsDestination(photos: number): boolean {
  return photos > 0;
}

/** What a roster column would make (C3): the new groups' names, and the values skipped because a group has the name. */
export interface ColumnGroupsPreview {
  make: { name: string; people: number }[];
  skipped: string[];
}

/** The roster fields a column is read from. */
export interface ColumnPerson {
  class: { name: string } | null;
  grade: string | null;
  firstName: string;
  lastName: string;
  studentId: string | null;
}

/** A person's value in a roster column, or null when blank. */
export function columnValue(person: ColumnPerson, column: GroupColumn): string | null {
  switch (column) {
    case "class":
      return person.class?.name ?? null;
    case "grade":
      return person.grade;
    case "firstName":
      return person.firstName;
    case "lastName":
      return person.lastName;
    case "studentId":
      return person.studentId;
  }
}

/**
 * The groups "Make groups from a column" would make, for the dialog to say before anything is saved: one per distinct
 * value (ignoring case and extra spaces), blank values none, a value whose name is already a group skipped. In natural
 * order. The database decides again when it runs.
 */
export function columnGroupsPreview(
  people: readonly ColumnPerson[],
  column: GroupColumn,
  groups: readonly { name: string }[],
): ColumnGroupsPreview {
  const taken = new Set(groups.map((g) => fold(g.name)));
  const values = new Map<string, { name: string; people: number }>();
  for (const person of people) {
    const raw = columnValue(person, column);
    const name = raw === null ? "" : cleanGroupName(raw);
    if (name === "") continue;
    const key = fold(name);
    const entry = values.get(key);
    if (entry) entry.people++;
    else values.set(key, { name, people: 1 });
  }
  const all = [...values.entries()].sort(([, a], [, b]) => natural.compare(a.name, b.name));
  return {
    make: all.filter(([key]) => !taken.has(key)).map(([, v]) => v),
    skipped: all.filter(([key]) => taken.has(key)).map(([, v]) => v.name),
  };
}

/** Whether an upload choice can start: group photos need a group (D156: "uploaded into a group"). */
export function uploadChoiceReady(kind: UploadKind, groupId: string | null): boolean {
  return kind === "individual" || groupId !== null;
}

/**
 * A person's line on Photos' People view (C15): their first card photo first, then everything else in shot order.
 * The server already sends it so; screens use this after Show all loads every photo in tagging order.
 */
export function cardFirst<T extends { place: string }>(photos: readonly T[]): T[] {
  const first = photos.findIndex((p) => p.place === "card");
  if (first <= 0) return [...photos];
  return [photos[first] as T, ...photos.slice(0, first), ...photos.slice(first + 1)];
}
