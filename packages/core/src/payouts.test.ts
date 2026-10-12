import { describe, expect, it } from "vitest";
import {
  canManagePayouts,
  canSeePayouts,
  formatBasisPoints,
  nextPayoutDay,
  type PayoutAccountFacts,
  payoutAccountStatus,
  payoutsConnected,
} from "./payouts";

const fresh: PayoutAccountFacts = {
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  disabledReason: "requirements.past_due",
  currentlyDue: 6,
  pastDue: 6,
  pendingVerification: 0,
};
const active: PayoutAccountFacts = {
  detailsSubmitted: true,
  chargesEnabled: true,
  payoutsEnabled: true,
  disabledReason: null,
  currentlyDue: 0,
  pastDue: 0,
  pendingVerification: 0,
};

describe("payoutAccountStatus (Seenu, answer 4 and Q5; ADR 0020)", () => {
  it("needs info while onboarding isn't finished, even though Stripe calls new accounts past due", () => {
    expect(payoutAccountStatus(fresh)).toBe("needs_info");
  });

  it("is active only with card payments and payouts enabled and nothing due", () => {
    expect(payoutAccountStatus(active)).toBe("active");
    // Pending verification of something not yet due doesn't stop an enabled account being active.
    expect(payoutAccountStatus({ ...active, pendingVerification: 2 })).toBe("active");
    expect(payoutAccountStatus({ ...active, currentlyDue: 1 })).toBe("needs_info");
    expect(payoutAccountStatus({ ...active, payoutsEnabled: false })).toBe("pending_verification");
    expect(payoutAccountStatus({ ...active, chargesEnabled: false })).toBe("pending_verification");
  });

  it("is pending verification once everything is in and Stripe is checking", () => {
    const checking = {
      ...active,
      chargesEnabled: false,
      payoutsEnabled: false,
      pendingVerification: 3,
      disabledReason: "requirements.pending_verification",
    };
    expect(payoutAccountStatus(checking)).toBe("pending_verification");
    expect(payoutAccountStatus({ ...checking, disabledReason: "under_review" })).toBe(
      "pending_verification",
    );
  });

  it("is restricted when Stripe stopped the account or submitted details are past due", () => {
    for (const reason of ["rejected.fraud", "rejected.other", "listed", "platform_paused", "other"])
      expect(payoutAccountStatus({ ...active, disabledReason: reason })).toBe("restricted");
    expect(
      payoutAccountStatus({ ...active, payoutsEnabled: false, pastDue: 1, currentlyDue: 1 }),
    ).toBe("restricted");
  });

  it("needs info when Stripe asks for more after submission", () => {
    expect(payoutAccountStatus({ ...active, chargesEnabled: false, currentlyDue: 2 })).toBe(
      "needs_info",
    );
    expect(
      payoutAccountStatus({
        ...active,
        chargesEnabled: false,
        disabledReason: "action_required.requested_capabilities",
      }),
    ).toBe("needs_info");
  });
});

describe("payoutsConnected and roles", () => {
  it("ticks for an Active account only (Q5)", () => {
    expect(payoutsConnected("active")).toBe(true);
    for (const s of ["needs_info", "pending_verification", "restricted", null, undefined] as const)
      expect(payoutsConnected(s)).toBe(false);
  });

  it("lets the owner manage and owners and admins see (answer 1)", () => {
    const roles = ["owner", "admin", "photographer", "staff"];
    expect(roles.map(canManagePayouts)).toEqual([true, false, false, false]);
    expect(roles.map(canSeePayouts)).toEqual([true, true, false, false]);
  });
});

describe("nextPayoutDay (Seenu, Q6 and Q9)", () => {
  const weekly = (weeklyAnchor: "monday" | "friday") => ({
    interval: "weekly" as const,
    weeklyAnchor,
    monthlyAnchor: null,
  });
  const monthly = (monthlyAnchor: number) => ({
    interval: "monthly" as const,
    weeklyAnchor: null,
    monthlyAnchor,
  });

  it("finds the next anchor weekday, today included", () => {
    // 2026-10-12 is a Monday.
    expect(nextPayoutDay(weekly("friday"), "2026-10-12")).toBe("2026-10-16");
    expect(nextPayoutDay(weekly("monday"), "2026-10-12")).toBe("2026-10-12");
    expect(nextPayoutDay(weekly("monday"), "2026-10-13")).toBe("2026-10-19");
    expect(nextPayoutDay(weekly("friday"), "2026-12-30")).toBe("2027-01-01");
  });

  it("pays 29th-31st anchors on the last day of shorter months, as Stripe does", () => {
    expect(nextPayoutDay(monthly(1), "2026-10-12")).toBe("2026-11-01");
    expect(nextPayoutDay(monthly(1), "2026-10-01")).toBe("2026-10-01");
    expect(nextPayoutDay(monthly(31), "2026-11-05")).toBe("2026-11-30");
    expect(nextPayoutDay(monthly(31), "2027-02-01")).toBe("2027-02-28");
    expect(nextPayoutDay(monthly(30), "2028-02-10")).toBe("2028-02-29");
    expect(nextPayoutDay(monthly(15), "2026-12-20")).toBe("2027-01-15");
  });

  it("has no single day for daily or paused payouts", () => {
    expect(
      nextPayoutDay({ interval: "daily", weeklyAnchor: null, monthlyAnchor: null }, "2026-10-12"),
    ).toBeNull();
    expect(
      nextPayoutDay({ interval: "manual", weeklyAnchor: null, monthlyAnchor: null }, "2026-10-12"),
    ).toBeNull();
    expect(nextPayoutDay(weekly("friday"), "not a day")).toBeNull();
  });
});

describe("formatBasisPoints", () => {
  it("writes percentages without floats", () => {
    expect(formatBasisPoints(300)).toBe("3");
    expect(formatBasisPoints(290)).toBe("2.9");
    expect(formatBasisPoints(25)).toBe("0.25");
    expect(formatBasisPoints(150)).toBe("1.5");
    expect(formatBasisPoints(0)).toBe("0");
    expect(() => formatBasisPoints(2.5)).toThrow();
  });
});
