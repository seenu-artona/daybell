import { describe, expect, it } from "vitest";
import {
  fieldErrors,
  JOB_LIST_PAGES,
  jobListQuery,
  LIST_FILTER_KEYS,
  LIST_PAGES,
  listFilterNeedsValue,
  listFiltersInput,
  listFiltersQuery,
  MAX_LIST_FILTERS,
  orderListQuery,
} from "./schemas";

// Saved filter chips and the list filters behind them (D147, ADR 0026): each list takes only its own keys, an id
// exactly where the key names a record, each chip once, at most eight; text never travels as a chip.
const JOB = "a0000000-0000-4000-8000-000000000001";
const CLIENT = "c0000000-0000-4000-8000-000000000001";

const errors = (result: ReturnType<typeof listFiltersInput.safeParse>) =>
  result.success ? null : fieldErrors(result.error);

describe("listFiltersInput (D147)", () => {
  it("takes each list's own keys, with an id where the key names a record", () => {
    expect(
      listFiltersInput.parse({
        page: "jobs",
        chips: [{ key: "closingThisWeek" }, { key: "client", value: CLIENT }],
      }).chips,
    ).toEqual([{ key: "closingThisWeek" }, { key: "client", value: CLIENT }]);
    expect(
      listFiltersInput.safeParse({
        page: "job_subjects",
        jobId: JOB,
        chips: [
          { key: "class", value: CLIENT },
          { key: "noClass", value: null },
        ],
      }).success,
    ).toBe(true);
    expect(listFiltersInput.safeParse({ page: "orders", chips: [] }).success).toBe(true);
  });

  it("refuses keys of another list, unknown keys and any key on Photos", () => {
    for (const [page, key] of [
      ["jobs", "deliveryHome"],
      ["orders", "client"],
      ["job_orders", "job"],
      ["jobs", "grade"],
      ["job_photos", "unsorted"],
    ] as const) {
      const jobId = (JOB_LIST_PAGES as readonly string[]).includes(page) ? { jobId: JOB } : {};
      expect(errors(listFiltersInput.safeParse({ page, ...jobId, chips: [{ key }] })), key).toEqual(
        { chips: "validation.filterChips" },
      );
    }
  });

  it("refuses a value on a key that takes none, and a missing one where it needs it", () => {
    expect(
      errors(
        listFiltersInput.safeParse({
          page: "jobs",
          chips: [{ key: "closingThisWeek", value: CLIENT }],
        }),
      ),
    ).toEqual({ chips: "validation.filterChips" });
    expect(
      errors(listFiltersInput.safeParse({ page: "jobs", chips: [{ key: "client" }] })),
    ).toEqual({
      chips: "validation.filterChips",
    });
  });

  it("refuses text where an id goes, so names never travel as chips", () => {
    const result = listFiltersInput.safeParse({
      page: "jobs",
      chips: [{ key: "client", value: "Lincoln Elementary" }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(errors(result))).not.toContain("Lincoln");
    expect(
      listFiltersInput.safeParse({ page: "jobs", chips: [{ key: "Lincoln Elementary" }] }).success,
    ).toBe(false);
    expect(
      listFiltersInput.safeParse({ page: "jobs", chips: [{ key: "closingThisWeek", name: "x" }] })
        .success,
    ).toBe(false);
  });

  it("refuses the same chip twice and more than eight", () => {
    expect(
      errors(
        listFiltersInput.safeParse({
          page: "jobs",
          chips: [
            { key: "client", value: CLIENT },
            { key: "client", value: CLIENT.toUpperCase() },
          ],
        }),
      ),
    ).toEqual({ chips: "validation.filterChips" });
    const nine = Array.from({ length: MAX_LIST_FILTERS + 1 }, (_, i) => ({
      key: "client",
      value: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    expect(errors(listFiltersInput.safeParse({ page: "jobs", chips: nine }))).toEqual({
      chips: "validation.filterChips",
    });
    expect(
      listFiltersInput.safeParse({ page: "jobs", chips: nine.slice(0, MAX_LIST_FILTERS) }).success,
    ).toBe(true);
  });

  it("needs the job for a job's tab, and takes none for a studio list", () => {
    expect(errors(listFiltersInput.safeParse({ page: "job_orders", chips: [] }))).toEqual({
      jobId: "validation.invalid",
    });
    expect(errors(listFiltersInput.safeParse({ page: "jobs", jobId: JOB, chips: [] }))).toEqual({
      jobId: "validation.invalid",
    });
    expect(listFiltersQuery.safeParse({ page: "job_subjects", jobId: "nope" }).success).toBe(false);
    expect(listFiltersQuery.safeParse({ page: "everything" }).success).toBe(false);
  });

  it("knows which keys take an id", () => {
    expect(listFilterNeedsValue("jobs", "client")).toBe(true);
    expect(listFilterNeedsValue("jobs", "closingThisWeek")).toBe(false);
    expect(listFilterNeedsValue("jobs", "toString")).toBeUndefined();
    expect(Object.keys(LIST_FILTER_KEYS).sort()).toEqual([...LIST_PAGES].sort());
  });
});

describe("list queries (D147)", () => {
  it("Jobs: show, client and a search of at most 120 characters", () => {
    expect(
      jobListQuery.parse({ show: "closingThisWeek", clientId: CLIENT, q: "  Lincoln " }),
    ).toMatchObject({ show: "closingThisWeek", clientId: CLIENT, q: "Lincoln" });
    expect(jobListQuery.safeParse({ show: "noOrdersYet" }).success).toBe(false);
    expect(jobListQuery.safeParse({ clientId: "Lincoln" }).success).toBe(false);
    expect(jobListQuery.safeParse({ q: "x".repeat(121) }).success).toBe(false);
  });

  it("Orders: the done stage", () => {
    expect(orderListQuery.parse({ stage: "done" }).stage).toBe("done");
    expect(orderListQuery.safeParse({ stage: "waiting" }).success).toBe(false);
  });
});
