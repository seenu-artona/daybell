import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { accountForDatabase, accountFacts, accountSchedule, payoutForDatabase, regionOfAccount } =
  await import("./payouts");

const base = {
  id: "acct_A1",
  details_submitted: false,
  charges_enabled: false,
  payouts_enabled: false,
  requirements: {
    currently_due: ["a", "b"],
    past_due: ["a"],
    pending_verification: [],
    disabled_reason: "requirements.past_due",
    current_deadline: 1_800_000_000,
  },
  settings: {
    payouts: { schedule: { interval: "weekly", weekly_anchor: "friday", delay_days: 2 } },
  },
  metadata: { daybell_studio_id: "s", daybell_region: "ca" },
};

describe("accountFacts and accountForDatabase (ADR 0020)", () => {
  it("keeps flags, counts and Stripe's code only, and works out the status", () => {
    expect(accountFacts(base)).toEqual({
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      disabledReason: "requirements.past_due",
      currentlyDue: 2,
      pastDue: 1,
      pendingVerification: 0,
      deadline: new Date(1_800_000_000_000).toISOString(),
    });
    const db = accountForDatabase(base);
    expect(db.status).toBe("needs_info");
    expect(Object.keys(db.facts).sort()).toEqual([
      "charges_enabled",
      "currently_due_count",
      "details_submitted",
      "disabled_reason",
      "past_due_count",
      "payouts_enabled",
      "pending_verification_count",
      "requirements_deadline",
    ]);
  });

  it("never keeps free text: an unexpected reason becomes other", () => {
    const odd = {
      ...base,
      requirements: { ...base.requirements, disabled_reason: "Ask Jane Doe" },
    };
    expect(accountFacts(odd).disabledReason).toBe("other");
  });

  it("reads several payout days as the first one, and refuses an unknown interval", () => {
    expect(
      accountSchedule({
        ...base,
        settings: {
          payouts: {
            schedule: {
              interval: "weekly",
              weekly_payout_days: ["tuesday", "friday"],
              delay_days: 3,
            },
          },
        },
      }),
    ).toEqual({ interval: "weekly", weeklyAnchor: "tuesday", monthlyAnchor: null, delayDays: 3 });
    expect(
      accountSchedule({
        ...base,
        settings: {
          payouts: {
            schedule: { interval: "monthly", monthly_payout_days: [15, 30], delay_days: 2 },
          },
        },
      }),
    ).toEqual({ interval: "monthly", weeklyAnchor: null, monthlyAnchor: 15, delayDays: 2 });
    expect(() =>
      accountSchedule({
        ...base,
        settings: { payouts: { schedule: { interval: "hourly", delay_days: 2 } } },
      }),
    ).toThrow("payout_schedule_unknown");
  });

  it("refuses a monthly schedule with no day (code review N8): it could never be saved", () => {
    expect(() =>
      accountSchedule({
        ...base,
        settings: { payouts: { schedule: { interval: "monthly", delay_days: 2 } } },
      }),
    ).toThrow("payout_schedule_unknown");
    expect(() =>
      accountSchedule({
        ...base,
        settings: {
          payouts: { schedule: { interval: "monthly", monthly_payout_days: [], delay_days: 2 } },
        },
      }),
    ).toThrow("payout_schedule_unknown");
  });
});

describe("payoutForDatabase", () => {
  const payout = {
    id: "po_1",
    amount: 500,
    currency: "cad",
    status: "in_transit",
    method: "standard",
    automatic: true,
    arrival_date: 1_760_054_400,
    failure_code: null,
    created: 1_760_000_000,
  };
  it("keeps amount, currency, status and dates only", () => {
    expect(payoutForDatabase(payout)).toMatchObject({
      stripe_payout_id: "po_1",
      amount_cents: 500,
      currency: "CAD",
      arrival_date: "2025-10-10",
    });
  });
  it("refuses statuses and methods Daybell doesn't know, and fractional amounts", () => {
    expect(() => payoutForDatabase({ ...payout, status: "lost" })).toThrow();
    expect(() => payoutForDatabase({ ...payout, method: "carrier_pigeon" })).toThrow();
    expect(() => payoutForDatabase({ ...payout, amount: 1.5 })).toThrow();
  });
});

describe("regionOfAccount (Claude's call Q11)", () => {
  it("uses the region Daybell wrote, if it is a payout region, else Canada", () => {
    expect(regionOfAccount(base)).toBe("ca");
    expect(regionOfAccount({ ...base, metadata: { daybell_region: "us" } })).toBe("ca");
    expect(regionOfAccount({ ...base, metadata: null })).toBe("ca");
  });
});
