import { describe, expect, it } from "vitest";
import {
  BUILT_IN_JOB_CHIPS,
  jobChipFrom,
  jobChipFromSaved,
  jobChipHref,
  jobsQuery,
  sameJobChip,
} from "./job-views";

const CLIENT = "c0000000-0000-4000-8000-000000000001";
const from = (query: string) => jobChipFrom(new URLSearchParams(query));

describe("Jobs chips (D147)", () => {
  it("built in: All, then each shop state", () => {
    expect(BUILT_IN_JOB_CHIPS.map(jobChipHref)).toEqual([
      "/app/jobs",
      "/app/jobs?status=draft",
      "/app/jobs?status=selling",
      "/app/jobs?status=closed",
    ]);
  });

  it("reads one chip from the address, and round-trips it", () => {
    for (const query of [
      "status=selling",
      "show=closingThisWeek",
      "show=pictureDayThisMonth",
      `client=${CLIENT}`,
    ]) {
      const { chip, clean } = from(query);
      expect(clean).toBe(false);
      expect(jobChipHref(chip)).toBe(`/app/jobs?${query}`);
    }
    expect(from("")).toEqual({ chip: { kind: "all" }, clean: false });
    // Home's "New job" link carries no chip.
    expect(from("new=1")).toEqual({ chip: { kind: "all" }, clean: false });
  });

  it("anything unknown, or two chips at once, is All and cleans the address", () => {
    for (const query of [
      "status=live",
      "show=noOrdersYet",
      "client=Lincoln%20SD",
      `status=draft&client=${CLIENT}`,
    ])
      expect(from(query)).toEqual({ chip: { kind: "all" }, clean: true });
  });

  it("saved chips become filters; unknown keys don't", () => {
    expect(jobChipFromSaved({ key: "closingThisWeek", value: null })).toEqual({
      kind: "show",
      show: "closingThisWeek",
    });
    expect(jobChipFromSaved({ key: "client", value: CLIENT })).toEqual({
      kind: "client",
      id: CLIENT,
    });
    expect(jobChipFromSaved({ key: "client", value: null })).toBeNull();
    expect(jobChipFromSaved({ key: "deliveryHome", value: null })).toBeNull();
    expect(sameJobChip({ kind: "client", id: CLIENT }, { kind: "client", id: CLIENT })).toBe(true);
  });

  it("asks the API for the chip, the day, the search and the next page", () => {
    expect(jobsQuery({ kind: "all" }, "2026-10-14", null)).toBe("/jobs?today=2026-10-14");
    expect(jobsQuery({ kind: "status", status: "draft" }, "2026-10-14", "abc")).toBe(
      "/jobs?today=2026-10-14&status=draft&cursor=abc",
    );
    expect(jobsQuery({ kind: "show", show: "closingThisWeek" }, "2026-10-14", null, "Lin")).toBe(
      "/jobs?today=2026-10-14&show=closingThisWeek&q=Lin",
    );
    expect(jobsQuery({ kind: "client", id: CLIENT }, "2026-10-14", null)).toBe(
      `/jobs?today=2026-10-14&clientId=${CLIENT}`,
    );
  });
});
