import { describe, expect, it } from "vitest";
import {
  buildRows,
  canEditRoster,
  countNewClasses,
  type DuplicateEntry,
  findDuplicates,
  guessColumns,
  normalizeHeader,
  parseYesNo,
  planRosterImport,
  ROSTER_SYNONYMS,
  ROSTER_TARGETS,
  type RosterRowDraft,
} from "./roster";

describe("canEditRoster", () => {
  it("lets owners, admins and photographers edit; staff only read", () => {
    expect(canEditRoster("owner")).toBe(true);
    expect(canEditRoster("admin")).toBe(true);
    expect(canEditRoster("photographer")).toBe(true);
    expect(canEditRoster("staff")).toBe(false);
    expect(canEditRoster("")).toBe(false);
  });
});

describe("guessing columns", () => {
  it("recognises every synonym in the table", () => {
    for (const target of ROSTER_TARGETS) {
      for (const synonym of ROSTER_SYNONYMS[target]) {
        expect(guessColumns([synonym])[0], `${synonym} -> ${target}`).toBe(target);
      }
    }
  });

  it("normalises headers from real school files", () => {
    expect(normalizeHeader("Student #")).toBe("student number");
    expect(normalizeHeader("Student No.")).toBe("student number");
    expect(normalizeHeader("Parent/Guardian E-mail")).toBe("parent guardian e mail");
    expect(normalizeHeader("  First_Name ")).toBe("first name");
  });

  it("maps a typical export", () => {
    expect(
      guessColumns([
        "Student First Name",
        "Student Last Name",
        "Homeroom",
        "Student #",
        "Grade",
        "Parent Email",
        "Photo Opt Out",
        "Bus route",
      ]),
    ).toEqual({
      0: "firstName",
      1: "lastName",
      2: "class",
      3: "studentId",
      4: "grade",
      5: "parentEmail",
      6: "doNotPhotograph",
      7: null,
    });
  });

  it("prefers first and last name columns over a generic name; Email means parent email", () => {
    expect(guessColumns(["Name", "First Name", "Last Name", "Email"])).toEqual({
      0: null,
      1: "firstName",
      2: "lastName",
      3: "parentEmail",
    });
  });

  it("never assigns a target twice, and earlier synonyms win", () => {
    // "class" comes before "teacher" in the class list, so Class wins and Teacher is left out.
    expect(guessColumns(["Teacher", "Class"])).toEqual({ 0: null, 1: "class" });
    expect(guessColumns(["First", "First Name"])).toEqual({ 0: null, 1: "firstName" });
    const twice = guessColumns(["Email", "Email"]);
    expect(Object.values(twice).filter((t) => t === "parentEmail")).toHaveLength(1);
  });

  it("leaves unknown columns out", () => {
    expect(guessColumns(["Allergies", ""])).toEqual({ 0: null, 1: null });
  });
});

describe("parseYesNo", () => {
  it("reads clear no's as no and anything else as yes (privacy first)", () => {
    for (const no of ["", " ", "no", "N", "FALSE", "0", "-"]) expect(parseYesNo(no)).toBe(false);
    for (const yes of ["yes", "Y", "TRUE", "1", "x", "Parent request"])
      expect(parseYesNo(yes)).toBe(true);
  });
});

describe("buildRows", () => {
  it("trims, collapses spaces, blanks to null, lower-cases emails", () => {
    const rows = buildRows(
      [["  Maya ", "Van   der Berg", " 4B ", "", "  ", " Maya.Parent@Example.COM ", "yes"]],
      {
        0: "firstName",
        1: "lastName",
        2: "class",
        3: "studentId",
        4: "grade",
        5: "parentEmail",
        6: "doNotPhotograph",
      },
    );
    expect(rows).toEqual([
      {
        firstName: "Maya",
        lastName: "Van der Berg",
        class: "4B",
        studentId: null,
        grade: null,
        parentEmail: "maya.parent@example.com",
        doNotPhotograph: true,
        doNotPublish: null,
      },
    ]);
  });

  it("leaves unmapped columns out and copes with short rows", () => {
    expect(buildRows([["Liam"]], { 0: "firstName", 1: "lastName", 2: null })).toEqual([
      {
        firstName: "Liam",
        lastName: "",
        class: null,
        studentId: null,
        grade: null,
        parentEmail: null,
        doNotPhotograph: null,
        doNotPublish: null,
      },
    ]);
  });
});

const entry = (e: Partial<DuplicateEntry>): DuplicateEntry => ({
  firstName: "Maya",
  lastName: "Johnson",
  studentId: null,
  class: null,
  ...e,
});

describe("duplicates", () => {
  it("match the same student ID, ignoring case and spaces", () => {
    expect(
      findDuplicates([
        entry({ studentId: "S-1" }),
        entry({ studentId: " s- 1", firstName: "Liam" }),
      ]),
    ).toEqual(new Set([0, 1]));
  });

  it("never match a child with an ID to one without", () => {
    expect(findDuplicates([entry({ studentId: "S-1" }), entry({})]).size).toBe(0);
  });

  it("match the same name in the same class without IDs", () => {
    expect(
      findDuplicates([
        entry({ class: "4B" }),
        entry({ class: " 4b ", firstName: "MAYA", lastName: "john son" }),
      ]),
    ).toEqual(new Set([0, 1]));
  });

  it("don't match the same name in different classes", () => {
    expect(findDuplicates([entry({ class: "4B" }), entry({ class: "4C" })]).size).toBe(0);
  });

  it("treat no class as a class", () => {
    expect(findDuplicates([entry({}), entry({ class: "" })])).toEqual(new Set([0, 1]));
    expect(findDuplicates([entry({}), entry({ class: "4B" })]).size).toBe(0);
  });

  it("compare accented names case-insensitively", () => {
    expect(findDuplicates([entry({ firstName: "Zoë" }), entry({ firstName: "ZOË" })])).toEqual(
      new Set([0, 1]),
    );
  });
});

const row = (r: Partial<RosterRowDraft>): RosterRowDraft => ({
  firstName: "Maya",
  lastName: "Johnson",
  class: null,
  studentId: null,
  grade: null,
  parentEmail: null,
  doNotPhotograph: null,
  doNotPublish: null,
  ...r,
});

describe("planRosterImport", () => {
  const existing = [
    { id: "c1", studentId: "S-1", firstName: "Maya", lastName: "Johnson", className: "4B" },
    { id: "c2", studentId: "S-2", firstName: "Liam", lastName: "Chen", className: "4B" },
    { id: "c3", studentId: "S-2", firstName: "Lena", lastName: "Chen", className: "4C" },
    { id: "c4", studentId: null, firstName: "Ava", lastName: "Patel", className: null },
  ];

  it("updates the one child with a matching student ID", () => {
    const plan = planRosterImport(existing, [row({ studentId: "s-1", lastName: "Johnson-Lee" })]);
    expect(plan.actions).toEqual([{ kind: "update", id: "c1" }]);
    expect(plan.duplicate).toEqual([false]);
  });

  it("adds a row whose ID matches two children (and flags it)", () => {
    const plan = planRosterImport(existing, [row({ studentId: "S-2", firstName: "Leo" })]);
    expect(plan.actions).toEqual([{ kind: "add" }]);
    expect(plan.duplicate).toEqual([true]);
  });

  it("updates with the first of two rows sharing an ID, adds the second, and flags both", () => {
    const plan = planRosterImport(existing, [
      row({ studentId: "S-1" }),
      row({ studentId: "S-1", firstName: "Mia" }),
    ]);
    expect(plan.actions).toEqual([{ kind: "update", id: "c1" }, { kind: "add" }]);
    expect(plan.duplicate).toEqual([true, true]);
  });

  it("adds rows without an ID", () => {
    expect(planRosterImport(existing, [row({ firstName: "Noah" })]).actions).toEqual([
      { kind: "add" },
    ]);
  });

  it("flags rows that duplicate a child already on the roster", () => {
    const plan = planRosterImport(existing, [
      row({ firstName: "ava", lastName: "PATEL" }),
      row({ firstName: "Ava", lastName: "Patel", class: "4B" }),
    ]);
    expect(plan.actions).toEqual([{ kind: "add" }, { kind: "add" }]);
    expect(plan.duplicate).toEqual([true, false]);
  });

  it("checks updated children with their new names and classes", () => {
    // Maya, renamed Ava Patel, keeps her student ID, so she never matches Ava Patel (who has none) by name.
    const plan = planRosterImport(existing, [
      row({ studentId: "S-1", firstName: "Ava", lastName: "Patel" }),
    ]);
    expect(plan.duplicate).toEqual([false]);
  });

  it("counts classes the job doesn't have yet", () => {
    expect(
      countNewClasses(
        ["4B", "Room 5"],
        [{ class: "4b" }, { class: "4C" }, { class: "4c " }, { class: null }],
      ),
    ).toBe(1);
  });
});
