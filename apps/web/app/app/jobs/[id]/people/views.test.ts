import { applyFilters, matchesSearch, type PersonRow } from "@daybell/core";
import { describe, expect, it } from "vitest";
import {
  classChoiceFrom,
  classChoiceValue,
  SUBJECT_VIEWS,
  subjectFilters,
  subjectsHref,
  subjectView,
} from "./views";

const BASE = "/app/jobs/0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e/people";
const CHILD = "c0000000-0000-4000-8000-000000000001";

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: "x",
  firstName: "Ava",
  lastName: "Patel",
  studentId: null,
  grade: null,
  accessCode: null,
  group: null,
  doNotPhotograph: false,
  doNotPublish: false,
  duplicate: false,
  ...over,
});

describe("Subjects views (D144)", () => {
  it("are All and the three flag views, in order", () => {
    expect(SUBJECT_VIEWS).toEqual(["all", "duplicates", "doNotPhotograph", "doNotPublish"]);
  });

  it("read ?show=, and treat anything unknown as All", () => {
    expect(subjectView("duplicates")).toBe("duplicates");
    expect(subjectView("doNotPublish")).toBe("doNotPublish");
    for (const v of [null, "", "all", "nope", "Ava Patel"]) expect(subjectView(v)).toBe("all");
  });

  it("keep the view in the address with the open child, and nothing else (D113)", () => {
    expect(subjectsHref(BASE, "all")).toBe(BASE);
    expect(subjectsHref(BASE, "duplicates")).toBe(`${BASE}?show=duplicates`);
    expect(subjectsHref(BASE, "all", CHILD)).toBe(`${BASE}?child=${CHILD}`);
    expect(subjectsHref(BASE, "doNotPhotograph", CHILD)).toBe(
      `${BASE}?show=doNotPhotograph&child=${CHILD}`,
    );
  });

  it("turn the class menu's value into a choice and back", () => {
    for (const v of ["", "none", "g1"]) expect(classChoiceValue(classChoiceFrom(v))).toBe(v);
  });

  it("combine the view, class and grade with AND; search applies on top", () => {
    const rows = [
      row({ id: "1", duplicate: true, group: { id: "g1", name: "4B" }, grade: "4" }),
      row({ id: "2", duplicate: true, group: { id: "g2", name: "5A" }, grade: "4" }),
      row({ id: "3", duplicate: false, group: { id: "g1", name: "4B" }, grade: "4" }),
      row({ id: "4", duplicate: true, group: null, grade: "4", firstName: "Liam" }),
      row({ id: "5", duplicate: true, group: { id: "g1", name: "4B" }, grade: "5" }),
    ];
    const pick = (f: Parameters<typeof subjectFilters>[0], q = "") =>
      applyFilters(rows, subjectFilters(f))
        .filter((r) => matchesSearch(r, q))
        .map((r) => r.id);
    const all = { kind: "all" } as const;
    expect(pick({ view: "all", classChoice: all, grade: "" })).toEqual(["1", "2", "3", "4", "5"]);
    expect(pick({ view: "duplicates", classChoice: all, grade: "" })).toEqual(["1", "2", "4", "5"]);
    expect(
      pick({ view: "duplicates", classChoice: { kind: "group", id: "g1" }, grade: "" }),
    ).toEqual(["1", "5"]);
    expect(
      pick({ view: "duplicates", classChoice: { kind: "group", id: "g1" }, grade: "4" }),
    ).toEqual(["1"]);
    expect(pick({ view: "all", classChoice: { kind: "none" }, grade: "" })).toEqual(["4"]);
    expect(pick({ view: "duplicates", classChoice: all, grade: "4" }, "liam")).toEqual(["4"]);
  });

  it("add no filter for All, every class and every grade", () => {
    expect(subjectFilters({ view: "all", classChoice: { kind: "all" }, grade: "" })).toEqual([]);
  });
});
