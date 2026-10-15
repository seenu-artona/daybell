import { expect, test } from "@playwright/test";
import { joinAs, signUpOwner } from "./helpers";

// Settings › Stripe (D150; ADR 0027), first built as Phase 1 step 7 "Payouts with Stripe Connect" (D56, D98, D106,
// D143, D96, D113; Seenu's answers 1–4 and Q1–Q6, Claude's calls of Oct 12 2026; ADR 0020), against the fake Stripe
// (STRIPE_DRIVER=fake: no real Stripe call in CI, Claude's call Q12): the owner goes from Not started through Stripe's
// (fake) hosted onboarding, leaving it unfinished (Needs info) then finishing it (Active, by the signed webhook and the
// return check); "Set up payouts" and the Publish shop dialog's "Payouts connected" tick; an expired Stripe link asks
// the owner to continue; the schedule changes to monthly, and a failed save's problem goes once a save works; the fees
// are stated, the next and recent payouts wait for Analytics; a paid payout is recorded in CAD; an admin sees it
// read-only; a photographer has no Stripe link and is refused; another studio sees nothing; and it all works from the
// keyboard. The local stack is the Canadian database (D122). Desktop only (D136).
const run = `${Date.now()}`;
/** A whole-text match: the status line says exactly this, not something that merely contains it. */
const whole = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

test("settings › stripe: onboarding on (fake) Stripe, status, schedule, fees, roles and separation", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Payout Studio ${tag}`,
    slug: `payout-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `payout-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");

  // 1. Home's setup checklist starts with "Set up payouts" (D143's order), linked to Settings › Stripe (D150).
  const setup = page.getByRole("region", { name: "Set up your studio", exact: true });
  await expect(setup.getByText("1 of 4 done", { exact: true })).toBeVisible();
  await setup.getByRole("link", { name: "Set up payouts Next", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/payouts$/);
  const sections = main.getByRole("navigation", { name: "Settings sections", exact: true });
  await expect(sections.getByRole("link", { name: "Stripe", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Settings (h1) › Stripe (h2, for screen readers) › the cards (h3): no skipped heading level.
  await expect(main.getByRole("heading", { name: "Stripe", level: 2, exact: true })).toHaveCount(1);
  const connection = main.getByRole("region", { name: "Connection", exact: true });
  await expect(connection.getByText("Not started", { exact: true })).toBeVisible();
  await expect(
    connection.getByText("You’ll go to Stripe to finish, then come back here.", { exact: true }),
  ).toBeVisible();
  const fees = main.getByRole("region", { name: "Fees", exact: true });
  await expect(
    fees.getByText(
      "Silverback: 3% of product sales. Nothing if nothing sells, and never on shipping or tax.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    fees.getByText(/^Stripe payout fees: .* passed on at Stripe’s rates\.$/),
  ).toBeVisible();
  await expect(fees.getByText(/^Instant payouts: .*coming later\.$/)).toBeVisible();
  // Connection, schedule and fees only (D150; Seenu, 2026-10-14): the next and recent payouts wait for Analytics.
  for (const name of ["Next payout", "Recent payouts"])
    await expect(main.getByRole("region", { name, exact: true })).toHaveCount(0);
  await expect(
    main
      .getByRole("region", { name: "Payout schedule", exact: true })
      .getByText("You can choose a schedule once you’ve started setting up payouts.", {
        exact: true,
      }),
  ).toBeVisible();

  // 2. "Set up payouts" goes to Stripe's hosted onboarding (the fake one here).
  await connection.getByRole("button", { name: "Set up payouts", exact: true }).click();
  await expect(page).toHaveURL(/\/dev\/stripe-onboarding\?account=acct_/);
  await expect(
    main.getByRole("heading", { name: "Fake Stripe onboarding", level: 1, exact: true }),
  ).toBeVisible();

  // 3. Leaving it unfinished comes back to Needs info, checked with Stripe and announced.
  await main.getByRole("button", { name: "Leave unfinished", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/payouts$/);
  await expect(
    main.getByRole("status").filter({ hasText: whole("Status checked: Needs info.") }),
  ).toBeVisible();
  await expect(connection.getByText("Needs info", { exact: true })).toBeVisible();

  // An expired Stripe link (Stripe sends the owner to ?stripe=refresh): a note, the address cleaned up, no redirect,
  // and the way back to Stripe still there.
  await page.goto("/app/settings/payouts?stripe=refresh");
  await expect(
    main.getByText("That Stripe link has expired. Continue on Stripe to get a new one.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app\/settings\/payouts$/);
  await expect(
    connection.getByRole("button", { name: "Continue on Stripe", exact: true }),
  ).toBeVisible();

  // 4. Continuing and finishing: the signed webhook and the return check both say Active.
  await connection.getByRole("button", { name: "Continue on Stripe", exact: true }).click();
  await main.getByRole("button", { name: "Finish onboarding", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/payouts$/);
  await expect(
    main.getByRole("status").filter({ hasText: whole("Status checked: Active.") }),
  ).toBeVisible();
  await expect(connection.getByText("Active", { exact: true })).toBeVisible();
  await expect(
    connection.getByRole("button", { name: "Manage on Stripe", exact: true }),
  ).toBeVisible();
  // Active, yet no next payout here: it waits for Analytics (D150).
  await expect(main.getByRole("region", { name: "Next payout", exact: true })).toHaveCount(0);

  // The onboarding task ticks (Seenu, Q5)...
  await page.goto("/app");
  await expect(setup.getByRole("link", { name: "Set up payouts Done", exact: true })).toBeVisible();
  await expect(setup.getByText("2 of 4 done", { exact: true })).toBeVisible();
  // ...and so does the Publish shop dialog's "Payouts connected" (D152 renamed the button).
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Payout Job ${tag}`, type: "school", pictureDay: "2030-05-01" },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  await page.goto(`/app/jobs/${jobId}`);
  await main.getByRole("button", { name: "Publish shop", exact: true }).click();
  const sell = page.getByRole("dialog", { name: "Before you can sell", exact: true });
  const payoutsItem = sell
    .getByRole("listitem")
    .filter({ has: page.getByText("Payouts connected", { exact: true }) });
  await expect(payoutsItem.getByText("Done", { exact: true })).toBeVisible();
  // The footer's Close (it has the word; the title bar's X is named by aria-label only).
  await sell
    .getByRole("button", { name: "Close", exact: true })
    .filter({ hasText: whole("Close") })
    .click();

  // 5. The owner changes the schedule to monthly on the 15th, by keyboard, and it is announced.
  await page.goto("/app/settings/payouts");
  const schedule = main.getByRole("region", { name: "Payout schedule", exact: true });
  const weekly = schedule.getByRole("radio", { name: "Weekly", exact: true });
  await expect(weekly).toBeChecked();
  await expect(schedule.getByLabel("Day of the week", { exact: true })).toHaveValue("friday");
  await weekly.focus();
  await page.keyboard.press("ArrowDown");
  await expect(schedule.getByRole("radio", { name: "Daily", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowDown");
  const monthly = schedule.getByRole("radio", { name: "Monthly", exact: true });
  await expect(monthly).toBeChecked();
  await expect(monthly).toBeFocused();
  // Focus is visible (D91): the browser's focus ring or our outline, never none.
  expect(await monthly.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Tab");
  const monthDay = schedule.getByLabel("Day of the month", { exact: true });
  await expect(monthDay).toBeFocused();
  await monthDay.selectOption("15");
  const save = schedule.getByRole("button", { name: "Save schedule", exact: true });
  // A save that fails shows its problem...
  await page.route(
    "**/api/v1/studio/payouts/schedule",
    (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: "internal", message: "Something went wrong on our side." } },
      }),
    { times: 1 },
  );
  await save.focus();
  await page.keyboard.press("Enter");
  const problem = main.getByText("Something went wrong on our side. Please try again.", {
    exact: true,
  });
  await expect(problem).toBeVisible();
  // ...which goes once the next save works.
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(
    main
      .getByRole("status")
      .filter({ hasText: whole("Payout schedule saved: Monthly, on day 15.") }),
  ).toBeVisible();
  await expect(problem).toHaveCount(0);

  // 6. Stripe pays a payout (the fake's signed payout.paid): the API has it in CAD (its list moves to Analytics, D150).
  const paid = await page.request.post("/api/dev-stripe", { data: { action: "payoutPaid" } });
  expect(paid.status()).toBe(200);
  await page.reload();
  await expect(main.getByRole("region", { name: "Connection", exact: true })).toBeVisible();
  await expect(main.getByRole("region", { name: "Recent payouts", exact: true })).toHaveCount(0);
  const mine = await (await page.request.get("/api/v1/studio/payouts")).json();
  expect(mine.payouts[0].amount).toEqual({ cents: 12345, currency: "CAD" });

  // 7. An admin sees it all, read-only (Seenu, answer 1).
  const admin = await joinAs(page, browser, `payout-admin-${tag}@example.test`, "admin");
  await admin.goto("/app/settings/payouts");
  const adminMain = admin.getByRole("main");
  await expect(
    adminMain
      .getByRole("region", { name: "Connection", exact: true })
      .getByText("Active", { exact: true }),
  ).toBeVisible();
  await expect(
    adminMain.getByText("Only the studio owner can set up or change payouts.", { exact: true }),
  ).toBeVisible();
  const adminSchedule = adminMain.getByRole("region", { name: "Payout schedule", exact: true });
  await expect(adminSchedule.getByText("Monthly, on day 15", { exact: true })).toBeVisible();
  for (const name of ["Connection", "Payout schedule"])
    await expect(
      adminMain.getByRole("region", { name, exact: true }).getByRole("button"),
    ).toHaveCount(0);
  await expect(adminMain.getByRole("region", { name: "Fees", exact: true })).toBeVisible();
  for (const name of ["Next payout", "Recent payouts"])
    await expect(adminMain.getByRole("region", { name, exact: true })).toHaveCount(0);
  expect(
    (
      await admin.request.put("/api/v1/studio/payouts/schedule", { data: { interval: "daily" } })
    ).status(),
  ).toBe(403);
  expect((await admin.request.post("/api/v1/studio/payouts/onboarding-link")).status()).toBe(403);

  // 8. A photographer has no Stripe link, and the page and the API refuse.
  const photographer = await joinAs(
    page,
    browser,
    `payout-photo-${tag}@example.test`,
    "photographer",
  );
  await photographer.goto("/app/settings");
  const photoMain = photographer.getByRole("main");
  await expect(
    photoMain
      .getByRole("navigation", { name: "Settings sections", exact: true })
      .getByRole("link", { name: "Stripe", exact: true }),
  ).toHaveCount(0);
  await photographer.goto("/app/settings/payouts");
  await expect(
    photoMain.getByText("Only the studio’s owner and admins can see this.", { exact: true }),
  ).toBeVisible();
  expect((await photographer.request.get("/api/v1/studio/payouts")).status()).toBe(403);

  // 9. Another studio sees nothing of it.
  const other = await signUpOwner(await (await browser.newContext()).newPage(), {
    studio: `Other Payouts ${tag}`,
    slug: `opay-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `payout-other-${tag}@example.test`,
  });
  const theirs = await (await other.request.get("/api/v1/studio/payouts")).json();
  expect(theirs).toMatchObject({ account: null, payouts: [], nextPayoutDate: null });
  await other.goto("/app/settings/payouts");
  await expect(
    other
      .getByRole("main")
      .getByRole("region", { name: "Connection", exact: true })
      .getByText("Not started", { exact: true }),
  ).toBeVisible();
  // The fake's controls act only on the caller's own studio's account.
  expect(
    (await other.request.post("/api/dev-stripe", { data: { action: "payoutPaid" } })).status(),
  ).toBe(404);
});
