import { type Browser, expect, type Page, test } from "@playwright/test";
import { PASSWORD, signUpOwner, VERIFY_LINK } from "./helpers";
import { linkFromEmail } from "./mail";

// Phase 1 step 7 "Payouts with Stripe Connect" (D56, D98, D106, D143, D96, D113; Seenu's answers 1–4 and Q1–Q6,
// Claude's calls of Oct 12 2026; ADR 0020), against the fake Stripe (STRIPE_DRIVER=fake: no real Stripe call in CI,
// Claude's call Q12): the owner goes from Not started through Stripe's (fake) hosted onboarding, leaving it unfinished
// (Needs info) then finishing it (Active, by the signed webhook and the return check); "Set up payouts" and the Start
// selling dialog's "Payouts connected" tick; the schedule changes to monthly; a paid payout shows in CAD; an admin sees
// it read-only; a photographer has no Payouts link and is refused; another studio sees nothing; and it all works from
// the keyboard. The local stack is the Canadian database (D122). Desktop only (D136).
const run = `${Date.now()}`;
/** A whole-text match: the status line says exactly this, not something that merely contains it. */
const whole = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** Invites someone with a role, and returns their signed-in tab after they join. */
async function join(page: Page, browser: Browser, email: string, role: string): Promise<Page> {
  const invite = await page.request.post("/api/v1/studio/invites", { data: { email, role } });
  expect(invite.status()).toBe(201);
  const joining = await (await browser.newContext()).newPage();
  await joining.goto((await invite.json()).link as string);
  await joining.getByRole("link", { name: "Create account", exact: true }).click();
  await joining.getByLabel("Your email").fill(email);
  await joining.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(
    joining.getByRole("heading", { name: "Check your inbox", exact: true }),
  ).toBeVisible();
  const tab = await joining.context().newPage();
  await tab.goto(await linkFromEmail(email, VERIFY_LINK));
  await joining.close();
  await tab.getByLabel("Password").fill(PASSWORD);
  await tab.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(tab).toHaveURL(/\/invite$/);
  await tab.getByRole("button", { name: "Join the team", exact: true }).click();
  await expect(tab).toHaveURL(/\/app$/);
  return tab;
}

test("payouts: onboarding on (fake) Stripe, status, schedule, payouts, roles and separation", async ({
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

  // 1. Home's setup checklist starts with "Set up payouts" (D143's order), linked to Settings › Payouts.
  const setup = page.getByRole("region", { name: "Set up your studio", exact: true });
  await expect(setup.getByText("1 of 4 done", { exact: true })).toBeVisible();
  await setup.getByRole("link", { name: "Set up payouts Next", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/payouts$/);
  const sections = main.getByRole("navigation", { name: "Settings sections", exact: true });
  await expect(sections.getByRole("link", { name: "Payouts", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const connection = main.getByRole("region", { name: "Connection", exact: true });
  await expect(connection.getByText("Not started", { exact: true })).toBeVisible();
  await expect(
    connection.getByText("You’ll go to Stripe to finish, then come back here.", { exact: true }),
  ).toBeVisible();
  const fees = main.getByRole("region", { name: "Fees", exact: true });
  await expect(
    fees.getByText(
      "Daybell: 3% of product sales. Nothing if nothing sells, and never on shipping or tax.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    fees.getByText(/^Stripe payout fees: .* passed on at Stripe’s rates\.$/),
  ).toBeVisible();
  await expect(fees.getByText(/^Instant payouts: .*coming later\.$/)).toBeVisible();
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
    page.getByRole("heading", { name: "Fake Stripe onboarding", level: 1 }),
  ).toBeVisible();

  // 3. Leaving it unfinished comes back to Needs info, checked with Stripe and announced.
  await page.getByRole("button", { name: "Leave unfinished", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/payouts$/);
  await expect(
    main.getByRole("status").filter({ hasText: whole("Status checked: Needs info.") }),
  ).toBeVisible();
  await expect(connection.getByText("Needs info", { exact: true })).toBeVisible();

  // 4. Continuing and finishing: the signed webhook and the return check both say Active.
  await connection.getByRole("button", { name: "Continue on Stripe", exact: true }).click();
  await page.getByRole("button", { name: "Finish onboarding", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/payouts$/);
  await expect(
    main.getByRole("status").filter({ hasText: whole("Status checked: Active.") }),
  ).toBeVisible();
  await expect(connection.getByText("Active", { exact: true })).toBeVisible();
  await expect(
    connection.getByRole("button", { name: "Manage on Stripe", exact: true }),
  ).toBeVisible();
  const next = main.getByRole("region", { name: "Next payout", exact: true });
  await expect(next.getByText(/^.+, if there’s money to pay out$/)).toBeVisible();

  // The onboarding task ticks (Seenu, Q5)...
  await page.goto("/app");
  await expect(setup.getByRole("listitem").filter({ hasText: "Set up payouts" })).toContainText(
    "Done",
  );
  await expect(setup.getByText("2 of 4 done", { exact: true })).toBeVisible();
  // ...and so does the Start selling dialog's "Payouts connected".
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Payout Job ${tag}`, type: "school", pictureDay: "2030-05-01" },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  await page.goto(`/app/jobs/${jobId}`);
  await main.getByRole("button", { name: "Start selling", exact: true }).click();
  const sell = page.getByRole("dialog", { name: "Before you can sell" });
  await expect(sell.getByRole("listitem").filter({ hasText: "Payouts connected" })).toContainText(
    "Done",
  );
  await sell.getByRole("button", { name: "Close" }).last().click();

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
  await schedule.getByRole("button", { name: "Save schedule", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    main
      .getByRole("status")
      .filter({ hasText: whole("Payout schedule saved: Monthly, on day 15.") }),
  ).toBeVisible();

  // 6. Stripe pays a payout (the fake's signed payout.paid): it shows in CAD.
  const paid = await page.request.post("/api/dev-stripe", { data: { action: "payoutPaid" } });
  expect(paid.status()).toBe(200);
  await page.reload();
  const recent = main.getByRole("region", { name: "Recent payouts", exact: true });
  const row = recent.getByRole("row").filter({ hasText: "$123.45" });
  await expect(row.getByRole("cell", { name: "Paid", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "Standard", exact: true })).toBeVisible();
  const mine = await (await page.request.get("/api/v1/studio/payouts")).json();
  expect(mine.payouts[0].amount).toEqual({ cents: 12345, currency: "CAD" });

  // 7. An admin sees it all, read-only (Seenu, answer 1).
  const admin = await join(page, browser, `payout-admin-${tag}@example.test`, "admin");
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
  expect(
    (
      await admin.request.put("/api/v1/studio/payouts/schedule", { data: { interval: "daily" } })
    ).status(),
  ).toBe(403);
  expect((await admin.request.post("/api/v1/studio/payouts/onboarding-link")).status()).toBe(403);

  // 8. A photographer has no Payouts link, and the page and the API refuse.
  const photographer = await join(
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
      .getByRole("link", { name: "Payouts", exact: true }),
  ).toHaveCount(0);
  await photographer.goto("/app/settings/payouts");
  await expect(
    photoMain.getByText("Only the studio’s owner and admins can see payouts.", { exact: true }),
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
