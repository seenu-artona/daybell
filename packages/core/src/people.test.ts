import { describe, expect, it } from "vitest";
import {
  addFilter,
  applyFilters,
  gradeOptions,
  groupPeople,
  matchesSearch,
  type PeopleFilter,
  type PersonRow,
  removeFilter,
} from "./people";

const G4B = { id: "g-4b", name: "4B" };
const G4C = { id: "g-4c", name: "4C" };

let n = 0;
const person = (over: Partial<PersonRow> = {}): PersonRow => ({
  id: `c-${++n}`,
  firstName: "Maya",
  lastName: "Johnson",
  studentId: null,
  grade: null,
  accessCode: "K7QM-4XPA",
  group: null,
  doNotPhotograph: false,
  doNotPublish: false,
  duplicate: false,
  ...over,
});

describe("matchesSearch", () => {
  const zoe = person({ firstName: "Zoë", lastName: "Côté", studentId: "S-204517" });

  it("matches everyone when the box is empty", () => {
    expect(matchesSearch(zoe, "")).toBe(true);
    expect(matchesSearch(zoe, "   ")).toBe(true);
  });

  it("matches names in either order, ignoring case and accents", () => {
    expect(matchesSearch(zoe, "zoe")).toBe(true);
    expect(matchesSearch(zoe, "ZOE COTE")).toBe(true);
    expect(matchesSearch(zoe, "cote zoe")).toBe(true);
    expect(matchesSearch(zoe, "Côté, Zoë")).toBe(true);
    expect(matchesSearch(zoe, "  zoe   co ")).toBe(true);
    expect(matchesSearch(zoe, "maya")).toBe(false);
  });

  it("matches the student ID", () => {
    expect(matchesSearch(zoe, "204517")).toBe(true);
    expect(matchesSearch(zoe, "s-2045")).toBe(true);
    expect(matchesSearch(person(), "204517")).toBe(false);
  });

  it("matches the access code with or without the dash, from 4 symbols", () => {
    expect(matchesSearch(zoe, "K7QM-4XPA")).toBe(true);
    expect(matchesSearch(zoe, "k7qm4xpa")).toBe(true);
    expect(matchesSearch(zoe, "7qm 4x")).toBe(true);
    expect(matchesSearch(zoe, "K7Q")).toBe(false);
    expect(matchesSearch(person({ accessCode: null }), "K7QM4XPA")).toBe(false);
  });
});

describe("filters", () => {
  const rows = [
    person({ group: G4B, grade: "4", doNotPhotograph: true }),
    person({ group: G4B, grade: "4", duplicate: true }),
    person({ group: G4C, grade: "5", doNotPublish: true, duplicate: true }),
    person({ group: null, grade: "K" }),
  ];
  const ids = (list: PersonRow[]) => list.map((r) => rows.indexOf(r));

  it("each filter keeps only its rows", () => {
    expect(ids(applyFilters(rows, [{ kind: "group", id: G4B.id }]))).toEqual([0, 1]);
    expect(ids(applyFilters(rows, [{ kind: "noGroup" }]))).toEqual([3]);
    expect(ids(applyFilters(rows, [{ kind: "grade", value: "5" }]))).toEqual([2]);
    expect(ids(applyFilters(rows, [{ kind: "grade", value: "k" }]))).toEqual([3]);
    expect(ids(applyFilters(rows, [{ kind: "doNotPhotograph" }]))).toEqual([0]);
    expect(ids(applyFilters(rows, [{ kind: "doNotPublish" }]))).toEqual([2]);
    expect(ids(applyFilters(rows, [{ kind: "duplicates" }]))).toEqual([1, 2]);
    expect(applyFilters(rows, [])).toHaveLength(4);
  });

  it("Not ordered and No photos use the roster's order and photo columns (D147)", () => {
    const listed = [
      person({ hasPaidOrder: true, photoCount: 3 }),
      person({ hasPaidOrder: false, photoCount: 0 }),
      person({ hasPaidOrder: null, photoCount: 2 }),
      person({}),
    ];
    const at = (list: PersonRow[]) => list.map((r) => listed.indexOf(r));
    expect(at(applyFilters(listed, [{ kind: "notOrdered" }]))).toEqual([1]);
    // Unknown (a photographer's null, or a list without the column) never counts as "no photos" or "not ordered".
    expect(at(applyFilters(listed, [{ kind: "noPhotos" }]))).toEqual([1]);
    expect(at(applyFilters(listed, [{ kind: "notOrdered" }, { kind: "noPhotos" }]))).toEqual([1]);
  });

  it("different kinds combine with AND", () => {
    const both: PeopleFilter[] = [{ kind: "group", id: G4B.id }, { kind: "duplicates" }];
    expect(ids(applyFilters(rows, both))).toEqual([1]);
  });

  it("each kind holds one value, and class and no class replace each other", () => {
    let filters = addFilter([], { kind: "group", id: G4B.id });
    filters = addFilter(filters, { kind: "group", id: G4C.id });
    expect(filters).toEqual([{ kind: "group", id: G4C.id }]);
    filters = addFilter(filters, { kind: "duplicates" });
    filters = addFilter(filters, { kind: "noGroup" });
    expect(filters).toEqual([{ kind: "duplicates" }, { kind: "noGroup" }]);
    filters = addFilter(filters, { kind: "group", id: G4B.id });
    expect(filters.map((f) => f.kind)).toEqual(["duplicates", "group"]);
    expect(removeFilter(filters, "duplicates")).toEqual([{ kind: "group", id: G4B.id }]);
  });
});

describe("gradeOptions", () => {
  it("lists distinct grades in natural order", () => {
    const rows = ["10", "2", "K", "1", "2", " 1 ", null, "k"].map((grade) => person({ grade }));
    expect(gradeOptions(rows)).toEqual(["1", "2", "10", "K"]);
  });
});

describe("groupPeople", () => {
  const groups = [G4B, G4C, { id: "g-empty", name: "Room 9" }];
  const rows = [
    person({ lastName: "Adams", group: G4C }),
    person({ lastName: "Brown", group: null }),
    person({ lastName: "Chen", group: G4B }),
    person({ lastName: "Diaz", group: G4C }),
  ];

  it("follows the groups' order, keeps row order, and puts no class last", () => {
    const sections = groupPeople(rows, groups, "group", { includeEmptyGroups: false });
    expect(sections.map((s) => s.key)).toEqual(["g-4b", "g-4c", "none"]);
    expect(sections[1]?.rows.map((r) => r.lastName)).toEqual(["Adams", "Diaz"]);
    expect(sections[2]?.group).toBeNull();
  });

  it("shows empty groups only when asked (no search or filter)", () => {
    const sections = groupPeople(rows, groups, "group", { includeEmptyGroups: true });
    expect(sections.map((s) => s.key)).toEqual(["g-4b", "g-4c", "g-empty", "none"]);
    expect(sections[2]?.rows).toEqual([]);
  });

  it("has no 'no class' section when everyone is in a class", () => {
    const sections = groupPeople(rows.slice(2), groups, "group", { includeEmptyGroups: false });
    expect(sections.map((s) => s.key)).toEqual(["g-4b", "g-4c"]);
  });

  it("keeps a group the groups list doesn't have yet", () => {
    const late = person({ group: { id: "g-new", name: "New" } });
    const sections = groupPeople([late], [G4B], "group", { includeEmptyGroups: false });
    expect(sections).toEqual([{ key: "g-new", group: { id: "g-new", name: "New" }, rows: [late] }]);
  });

  it("is one plain list when not grouped", () => {
    const sections = groupPeople(rows, groups, "none", { includeEmptyGroups: true });
    expect(sections).toEqual([{ key: "all", group: null, rows }]);
  });
});
