import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAYOUT_ACCOUNT_STATUSES,
  PAYOUT_INTERVALS,
  PAYOUT_METHODS,
  PAYOUT_STATUSES,
  PAYOUT_WEEKDAYS,
} from "@daybell/core";
import { describe, expect, it } from "vitest";
import { fieldErrors, payoutScheduleInput } from "./schemas";

const errors = (r: ReturnType<typeof payoutScheduleInput.safeParse>) =>
  r.success ? {} : fieldErrors(r.error);

describe("payoutScheduleInput (Seenu, answer 3 and Q6; ADR 0020)", () => {
  it("takes weekly on a weekday, daily, or monthly on a date", () => {
    expect(payoutScheduleInput.parse({ interval: "weekly", weeklyAnchor: "friday" })).toEqual({
      interval: "weekly",
      weeklyAnchor: "friday",
    });
    expect(payoutScheduleInput.parse({ interval: "daily" })).toEqual({ interval: "daily" });
    expect(payoutScheduleInput.parse({ interval: "monthly", monthlyAnchor: 31 })).toEqual({
      interval: "monthly",
      monthlyAnchor: 31,
    });
  });

  it("refuses weekends, impossible dates, manual and extra fields, with field keys", () => {
    expect(
      errors(payoutScheduleInput.safeParse({ interval: "weekly", weeklyAnchor: "saturday" })),
    ).toEqual({
      weeklyAnchor: "validation.payoutWeekday",
    });
    expect(errors(payoutScheduleInput.safeParse({ interval: "weekly" }))).toEqual({
      weeklyAnchor: "validation.payoutWeekday",
    });
    for (const monthlyAnchor of [0, 32, 1.5, "1"])
      expect(errors(payoutScheduleInput.safeParse({ interval: "monthly", monthlyAnchor }))).toEqual(
        {
          monthlyAnchor: "validation.payoutMonthDay",
        },
      );
    expect(payoutScheduleInput.safeParse({ interval: "manual" }).success).toBe(false);
    expect(
      payoutScheduleInput.safeParse({ interval: "daily", weeklyAnchor: "friday" }).success,
    ).toBe(false);
    expect(
      payoutScheduleInput.safeParse({ interval: "weekly", weeklyAnchor: "friday", delayDays: 0 })
        .success,
    ).toBe(false);
  });
});

describe("payouts match the database", () => {
  const sql = readFileSync(
    join(__dirname, "../../db/supabase/migrations/20261012300000_payouts.sql"),
    "utf8",
  );
  const values = (name: string) =>
    [
      ...(sql.match(new RegExp(`${name} as enum \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'(\w+)'/g),
    ].map((m) => m[1]);

  it("has the same statuses, intervals, weekdays and methods", () => {
    expect(values("payout_account_status")).toEqual([...PAYOUT_ACCOUNT_STATUSES]);
    expect(values("payout_interval")).toEqual([...PAYOUT_INTERVALS]);
    expect(values("payout_weekday")).toEqual([...PAYOUT_WEEKDAYS]);
    expect(values("payout_status")).toEqual([...PAYOUT_STATUSES]);
    expect(values("payout_method")).toEqual([...PAYOUT_METHODS]);
  });

  it("has the same bounds", () => {
    expect(sql).toContain("monthly_anchor smallint check (monthly_anchor between 1 and 31)");
  });
});
