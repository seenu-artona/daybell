import { describe, expect, it } from "vitest";
import { subjectChipFrom, subjectChipFromSaved, subjectFilters, subjectsHref } from "./views";

const BASE = "/app/jobs/j1/people";
const CLASS = "d0000000-0000-4000-8000-000000000001";
const CHILD = "c0000000-0000-4000-8000-000000000001";
const from = (query: string, seesOrders = true) =>
  subjectChipFrom(new URLSearchParams(query), { seesOrders });

describe("Subjects chips (D147)", () => {
  it("reads one chip from the address and round-trips it with the open child", () => {
    for (const query of [
      "show=notOrdered",
      "show=noPhotos",
      "show=duplicates",
      "show=doNotPhotograph",
      "show=doNotPublish",
      "show=noClass",
      `class=${CLASS}`,
    ]) {
      const { chip, clean } = from(query);
      expect(clean).toBe(false);
      expect(subjectsHref(BASE, chip)).toBe(`${BASE}?${query}`);
      expect(subjectsHref(BASE, chip, CHILD)).toBe(`${BASE}?${query}&child=${CHILD}`);
    }
    // The open child alone is All.
    expect(from(`child=${CHILD}`)).toEqual({ chip: { kind: "all" }, clean: false });
    expect(subjectsHref(BASE, { kind: "all" })).toBe(BASE);
  });

  it("unknown words, both parameters or a class that isn't an id are All, and clean the address", () => {
    for (const query of ["show=ordered", "class=4B", `show=noPhotos&class=${CLASS}`])
      expect(from(query)).toEqual({ chip: { kind: "all" }, clean: true });
  });

  it("Not ordered is only for people who see orders", () => {
    expect(from("show=notOrdered", false)).toEqual({ chip: { kind: "all" }, clean: true });
    expect(from("show=noPhotos", false).chip).toEqual({ kind: "show", show: "noPhotos" });
  });

  it("a grade never goes in the address", () => {
    expect(subjectsHref(BASE, { kind: "grade", grade: "4" }, CHILD)).toBe(`${BASE}?child=${CHILD}`);
  });

  it("each chip is one of core's filters", () => {
    expect(subjectFilters({ kind: "all" })).toEqual([]);
    expect(subjectFilters({ kind: "show", show: "noClass" })).toEqual([{ kind: "noGroup" }]);
    expect(subjectFilters({ kind: "show", show: "notOrdered" })).toEqual([{ kind: "notOrdered" }]);
    expect(subjectFilters({ kind: "class", id: CLASS })).toEqual([{ kind: "group", id: CLASS }]);
    expect(subjectFilters({ kind: "grade", grade: "K" })).toEqual([{ kind: "grade", value: "K" }]);
  });

  it("saved chips become filters; built-in and unknown keys don't", () => {
    expect(subjectChipFromSaved({ key: "class", value: CLASS })).toEqual({
      kind: "class",
      id: CLASS,
    });
    expect(subjectChipFromSaved({ key: "doNotPublish", value: null })).toEqual({
      kind: "show",
      show: "doNotPublish",
    });
    expect(subjectChipFromSaved({ key: "noPhotos", value: null })).toBeNull();
    expect(subjectChipFromSaved({ key: "grade", value: null })).toBeNull();
  });
});
