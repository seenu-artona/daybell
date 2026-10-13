import type { StudioPayoutsResponse } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import messages from "@/messages/en-CA.json";
import enUS from "@/messages/en-US.json";
import { SellChecklist } from "../../jobs/[id]/sell-checklist";
import {
  PayoutsCard,
  payoutProblemKey,
  ScheduleCard,
  StatusCard,
  scheduleFormKey,
} from "./payout-cards";

// Settings › Payouts and the Start selling dialog (ADR 0020; code review N3, N7, N9, N10): rendered to HTML with the
// real Canadian English words. What admins are told, the buttons' descriptions, the neutral "Manual payouts", the
// schedule form's identity, and "Checking…" before the payout account has been read.
const render = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en-CA", messages, timeZone: "UTC" } as ComponentProps<
        typeof NextIntlClientProvider
      >,
      element,
    ),
  );

const data = (over: Partial<StudioPayoutsResponse> = {}, account = {}): StudioPayoutsResponse => ({
  account: {
    status: "needs_info",
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: true,
    currentlyDue: 2,
    pastDue: 0,
    deadline: "2026-11-01T00:00:00.000Z",
    disabledReason: null,
    schedule: { interval: "weekly", weeklyAnchor: "friday", monthlyAnchor: null },
    ...account,
  },
  nextPayoutDate: null,
  payouts: [],
  fees: {
    daybellBasisPoints: 300,
    card: { basisPoints: 290, fixed: { cents: 30, currency: "CAD" } },
    payout: { basisPoints: 25, fixed: { cents: 25, currency: "CAD" } },
    activeAccount: { cents: 200, currency: "CAD" },
    instantBasisPoints: 100,
  },
  canManage: true,
  ...over,
});

const noop = () => {};

describe("StatusCard", () => {
  it("asks the owner to add what's due, and tells admins the owner needs to (they can't)", () => {
    const owner = render(createElement(StatusCard, { data: data(), onStripe: noop }));
    expect(owner).toContain("Please add them by Nov 1, 2026.");
    const admin = render(
      createElement(StatusCard, { data: data({ canManage: false }), onStripe: noop }),
    );
    expect(admin).toContain("The studio owner needs to add them by Nov 1, 2026.");
    expect(admin).not.toContain("Please add them");
    expect(admin).not.toContain("<button");
  });

  it("describes each Stripe button with the note under it (aria-describedby)", () => {
    const html = render(createElement(StatusCard, { data: data(), onStripe: noop }));
    const described = [...html.matchAll(/<button[^>]*aria-describedby="([^"]+)"[^>]*>([^<]+)</g)];
    expect(described.map((m) => m[2])).toEqual(["Continue on Stripe", "Manage on Stripe"]);
    for (const [, id] of described)
      expect(html).toMatch(new RegExp(`<p id="${id}"[^>]*>[^<]+</p>`));
    expect(html).toContain("You’ll go to Stripe to finish, then come back here.</p>");
  });
});

describe("manual payouts (Stripe's interval: manual)", () => {
  it("are named neutrally, never as Stripe pausing them", () => {
    const manual = data(
      { canManage: false },
      {
        status: "active",
        payoutsEnabled: true,
        schedule: { interval: "manual", weeklyAnchor: null, monthlyAnchor: null },
      },
    );
    const schedule = render(
      createElement(ScheduleCard, { data: manual, onSaving: noop, onSaved: noop, onProblem: noop }),
    );
    expect(schedule).toContain(">Manual payouts</p>");
    const next = render(createElement(PayoutsCard, { data: manual }));
    expect(next).toContain("Manual payouts: none are scheduled.");
    expect(schedule + next).not.toMatch(/paused/i);
  });
});

describe("scheduleFormKey", () => {
  it("changes when Stripe's schedule changes, so the form shows the new one", () => {
    const weekly = scheduleFormKey(data());
    expect(scheduleFormKey(data())).toBe(weekly);
    expect(
      scheduleFormKey(
        data({}, { schedule: { interval: "weekly", weeklyAnchor: "monday", monthlyAnchor: null } }),
      ),
    ).not.toBe(weekly);
    expect(
      scheduleFormKey(
        data({}, { schedule: { interval: "monthly", weeklyAnchor: null, monthlyAnchor: 15 } }),
      ),
    ).not.toBe(weekly);
    expect(scheduleFormKey({ ...data(), account: null })).toBe("none");
  });
});

describe("SellChecklist: Payouts connected", () => {
  const row = (payoutsConnected: boolean | undefined) => {
    const html = render(
      createElement(SellChecklist, {
        roster: 0,
        taggingReviewed: false,
        hasPriceList: true,
        payoutsConnected,
      }),
    );
    return /Payouts connected<\/span><span[^>]*>([^<]+)</.exec(html)?.[1];
  };

  it("says Checking… until the account is read, then Done or To do, never Coming soon", () => {
    expect(row(undefined)).toBe("Checking…");
    expect(row(true)).toBe("Done");
    expect(row(false)).toBe("To do");
  });
});

describe("payoutProblemKey (code review N5)", () => {
  const word = (m: typeof messages, key: string) =>
    key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], m.app.payouts);

  it("shows each payout form code's own words in both locales, and the general text otherwise", () => {
    expect(payoutProblemKey({ form: "payouts.platformSetup" })).toBe("platformSetup");
    expect(payoutProblemKey({ form: "payouts.notConfigured" })).toBe("notConfigured");
    expect(payoutProblemKey({ form: "payouts.noContactEmail" })).toBe("noContactEmail");
    expect(payoutProblemKey({ form: "payouts.createConflict" })).toBe("createConflict");
    expect(payoutProblemKey({ form: "payouts.alreadyConnected" })).toBe(
      "conflicts.alreadyConnected",
    );
    expect(payoutProblemKey({ form: "payouts.notConnected" })).toBe("conflicts.notConnected");
    expect(payoutProblemKey({})).toBeNull();
    expect(payoutProblemKey({ form: "something.else" })).toBeNull();
    for (const key of [
      "platformSetup",
      "noContactEmail",
      "createConflict",
      "notConfigured",
      "conflicts.alreadyConnected",
      "conflicts.notConnected",
    ])
      for (const m of [messages, enUS]) expect(typeof word(m, key), key).toBe("string");
  });

  it("tells the owner Daybell's platform setup isn't finished and to contact support, not to try again (N2)", () => {
    for (const m of [messages, enUS]) {
      expect(m.app.payouts.platformSetup).toContain("contact Daybell support");
      expect(m.app.payouts.platformSetup).not.toMatch(/try again/i);
    }
  });
});
