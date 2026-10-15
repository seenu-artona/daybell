import { describe, expect, it } from "vitest";
import {
  type ColumnPerson,
  cardFirst,
  chunk,
  cleanGroupName,
  columnGroupsPreview,
  columnValue,
  deleteNeedsDestination,
  GROUP_COLUMNS,
  groupNameProblem,
  isGroupNameText,
  MAX_GROUP_CHANGE,
  membersChange,
  membersRequests,
  sortPhotoGroups,
  uploadChoiceReady,
} from "./photo-groups";

const groups = [
  { id: "g1", name: "Choir" },
  { id: "g2", name: "Room 10" },
  { id: "g3", name: "Room 2" },
];

describe("group names (C10)", () => {
  it("cleans spaces", () => {
    expect(cleanGroupName("  Jazz   band ")).toBe("Jazz band");
  });

  it("refuses empty, long and taken names, ignoring case", () => {
    expect(groupNameProblem("", groups)).toBe("empty");
    expect(groupNameProblem("x".repeat(61), groups)).toBe("tooLong");
    expect(groupNameProblem("x".repeat(60), groups)).toBeNull();
    expect(groupNameProblem("choir", groups)).toBe("taken");
    expect(groupNameProblem("Band", groups)).toBeNull();
    // The same clean-text rule as price list names (and the database): no control, C1 or bidi characters.
    for (const bad of ["Ev\u202Eil", "Iso\u2066late", "C1\u0085", "Bell\u0007", "Lone\uD800"])
      expect(groupNameProblem(bad, groups)).toBe("invalid");
    expect(isGroupNameText("Émilie’s 😀 group")).toBe(true);
  });

  it("lets a group keep its own name when renamed", () => {
    expect(groupNameProblem("CHOIR", groups, "g1")).toBeNull();
    expect(groupNameProblem("choir", groups, "g2")).toBe("taken");
  });
});

describe("sortPhotoGroups", () => {
  it("sorts by name in natural order", () => {
    expect(sortPhotoGroups(groups).map((g) => g.name)).toEqual(["Choir", "Room 2", "Room 10"]);
  });
});

describe("members", () => {
  it("sends who joins and who leaves", () => {
    expect(membersChange(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual({
      add: ["c"],
      remove: ["a"],
    });
    expect(membersChange(new Set(["a"]), new Set(["a"]))).toEqual({ add: [], remove: [] });
  });

  it("sends at most 500 ids each way per request (C10)", () => {
    const add = Array.from({ length: 1001 }, (_, i) => `a${i}`);
    const requests = membersRequests({ add, remove: ["r"] });
    expect(requests.map((r) => [r.add.length, r.remove.length])).toEqual([
      [500, 1],
      [500, 0],
      [1, 0],
    ]);
    expect(membersRequests({ add: [], remove: [] })).toEqual([]);
  });

  it("chunks by 500", () => {
    expect(chunk(Array.from({ length: 1000 }, (_, i) => i)).map((c) => c.length)).toEqual([
      MAX_GROUP_CHANGE,
      MAX_GROUP_CHANGE,
    ]);
    expect(chunk([])).toEqual([]);
  });
});

describe("deleting a group (C4)", () => {
  it("asks where the photos go only when it has some", () => {
    expect(deleteNeedsDestination(0)).toBe(false);
    expect(deleteNeedsDestination(3)).toBe(true);
  });
});

describe("columnGroupsPreview (C3)", () => {
  const person = (klass: string | null, grade: string | null) => ({
    class: klass === null ? null : { name: klass },
    grade,
  });
  const people = [
    person("4B", "3"),
    person("4b ", " 3"),
    person("Choir", "K"),
    person(null, null),
    person("Room 10", ""),
    person("Room 2", "4"),
  ];

  it("makes one group per value, skips names already used, and none for blanks", () => {
    expect(columnGroupsPreview(people, "class", groups)).toEqual({
      make: [{ name: "4B", people: 2 }],
      skipped: ["Choir", "Room 2", "Room 10"],
    });
    expect(columnGroupsPreview(people, "class", []).make.map((g) => g.name)).toEqual([
      "4B",
      "Choir",
      "Room 2",
      "Room 10",
    ]);
  });

  it("offers the class and grade only: never a name, an ID, an email or a flag (Seenu, Oct 14)", () => {
    expect(GROUP_COLUMNS).toEqual(["class", "grade"]);
    expect(columnValue(people[3] as ColumnPerson, "class")).toBeNull();
  });

  it("cleans values as the database does, and skips ones that can't be names", () => {
    const odd = [
      person("Room   4", null),
      person("room 4", null),
      person("Ev\u202Eil", null),
      person("x".repeat(61), null),
      person("Tab\tbed", null),
    ];
    expect(columnGroupsPreview(odd, "class", [])).toEqual({
      make: [
        { name: "Room 4", people: 2 },
        { name: "Tab bed", people: 1 },
      ],
      skipped: [],
    });
  });

  it("reads grades too", () => {
    expect(columnGroupsPreview(people, "grade", [])).toEqual({
      make: [
        { name: "3", people: 2 },
        { name: "4", people: 1 },
        { name: "K", people: 1 },
      ],
      skipped: [],
    });
  });
});

describe("uploads", () => {
  it("group photos need their group", () => {
    expect(uploadChoiceReady("individual", null)).toBe(true);
    expect(uploadChoiceReady("group", null)).toBe(false);
    expect(uploadChoiceReady("group", "g1")).toBe(true);
  });
});

describe("cardFirst (C15)", () => {
  it("puts the first card photo first and keeps the rest in shot order", () => {
    const strip = [
      { id: "1", place: "child" },
      { id: "2", place: "card" },
      { id: "3", place: "child" },
      { id: "4", place: "card" },
    ];
    expect(cardFirst(strip).map((p) => p.id)).toEqual(["2", "1", "3", "4"]);
    expect(cardFirst([{ id: "1", place: "child" }]).map((p) => p.id)).toEqual(["1"]);
  });
});
