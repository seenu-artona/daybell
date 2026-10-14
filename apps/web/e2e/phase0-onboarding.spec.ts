import { expect, test } from "@playwright/test";
import { PASSWORD, VERIFY_LINK } from "./helpers";
import { linkFromEmail } from "./mail";

// Phase 0 "Done when" (steps 1, 2, 5): sign up a studio, confirm the email, invite staff, staff joins with a role,
// and a second studio sees nothing of the first. Since Phase 1 step 2d (D143; ADR 0017) Home shows the studio setup
// checklist until it is done, then Up next. Unique emails per run. Desktop only (D136; ADR 0013).
const run = `${Date.now()}`;

test("owner signs up, invites a photographer, and studios stay separate", async ({
  page: firstTab,
  browser,
}, info) => {
  let page = firstTab;
  const tag = `${info.project.name}-${run}`;
  const owner = `owner-${tag}@example.test`;
  const photographer = `photographer-${tag}@example.test`;
  const slug = `north-peak-${tag}`.slice(0, 40).replace(/-+$/, "");

  // 1. Owner signs up.
  await page.goto("/sign-up");
  await page.getByLabel("Studio name").fill(`North Peak ${tag}`);
  await page.getByLabel("Studio web address").fill(slug);
  await page.getByLabel("Your email").fill(owner);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  // 2. Confirms the email, chooses a password, and lands in their new studio.
  // Opened in a new tab, as from a mail app.
  const confirmTab = await page.context().newPage();
  await confirmTab.goto(await linkFromEmail(owner, VERIFY_LINK));
  await page.close();
  page = confirmTab;
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.getByText(`North Peak ${tag}`).filter({ visible: true }).first()).toBeVisible();
  const setup = page.getByRole("region", { name: "Set up your studio", exact: true });
  // Account, payouts, price list and first job: inviting the team stays in Settings (Seenu, answer 12). D143's order:
  // payouts (ADR 0020), then the price list (ADR 0019), then the first job.
  await expect(setup.getByText("1 of 4 done", { exact: true })).toBeVisible();
  await expect(
    setup.getByRole("listitem").filter({ hasText: "Create your account" }),
  ).toContainText("Done");
  // The row's link is named by its label and its state in words ("Next").
  await expect(
    setup.getByRole("link", { name: "Set up payouts Next", exact: true }),
  ).toHaveAttribute("href", "/app/settings/payouts");
  await expect(
    setup.getByRole("link", { name: "Review your price list To do", exact: true }),
  ).toHaveAttribute("href", "/app/products");
  await expect(
    setup.getByRole("listitem").filter({ hasText: "Create your first job" }),
  ).toContainText("To do");
  await expect(setup.getByText("Invite your team")).toHaveCount(0);

  // Every section is in the one dark menu; unbuilt ones say "Soon" (D126, D128). Products is built since step 6
  // (ADR 0019) and Orders since step 11 (ADR 0024). There is no top bar (D137).
  const menu = page.getByRole("navigation", { name: "Main" });
  // Contacts is labelled Clients (D144); its route stays /app/contacts.
  await expect(menu.getByRole("link", { name: "Clients", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Products", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Orders", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Marketing Soon" })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /Marketing/ })
    .click();
  await expect(page.getByRole("heading", { name: "Marketing is coming soon" })).toBeVisible();

  // 3. Goes to Settings and invites a photographer.
  await menu.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByRole("cell", { name: /Owner/ })).toBeVisible();
  await page.getByLabel("Their email").fill(photographer);
  await page.getByLabel("Role").selectOption("photographer");
  await page.getByRole("button", { name: "Create invite" }).click();
  let inviteLink = (await page.locator("code").textContent())?.trim() ?? "";
  expect(inviteLink).toMatch(/\/invite#[0-9a-f]{64}$/);
  await expect(page.getByText("Waiting to join")).toBeVisible();

  // Withdrawing an invite works; then invite again for the photographer to use.
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Waiting to join")).toHaveCount(0);
  await page.getByLabel("Their email").fill(photographer);
  await page.getByLabel("Role").selectOption("photographer");
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByText("Waiting to join")).toBeVisible();
  inviteLink = (await page.locator("code").textContent())?.trim() ?? "";

  // Inviting doesn't change the setup checklist; the activity log has all three changes (event log, D96).
  await page.goto("/app");
  await expect(setup.getByText("1 of 4 done", { exact: true })).toBeVisible();
  await expect(page.getByText(`${owner} withdrew an invite`)).toBeVisible();
  await expect(page.getByText(`${owner} invited someone as photographer`).first()).toBeVisible();

  // ⌘K / Ctrl+K focuses the menu's search box (D138); the shortcut is never shown as a label.
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("combobox", { name: "Search jobs and clients" });
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
  await expect(page.getByText(/⌘K|Ctrl K/)).toHaveCount(0);
  await search.press("Escape");
  await menu.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);

  // 4. The photographer, in a fresh browser, creates an account from the invite and joins.
  const staff = await (await browser.newContext()).newPage();
  await staff.goto(inviteLink);
  await staff.getByRole("link", { name: "Create account" }).click();
  await staff.getByLabel("Your email").fill(photographer);
  await staff.getByRole("button", { name: "Email me a link" }).click();
  await expect(staff.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  // The confirmation opens in a new tab; the invite must survive that.
  const staffConfirm = await staff.context().newPage();
  await staffConfirm.goto(await linkFromEmail(photographer, VERIFY_LINK));
  await staff.close();
  const staffTab = staffConfirm;
  await staffTab.getByLabel("Password").fill(PASSWORD);
  await staffTab.getByRole("button", { name: "Save and continue" }).click();
  await expect(staffTab).toHaveURL(/\/invite$/);
  await staffTab.getByRole("button", { name: "Join the team" }).click();
  await expect(staffTab).toHaveURL(/\/app$/);
  await expect(
    staffTab.getByText(`North Peak ${tag}`).filter({ visible: true }).first(),
  ).toBeVisible();
  // Photographers see the team but cannot invite, and have no Payouts section (ADR 0020).
  await staffTab.goto("/app/settings");
  await expect(staffTab.getByText("Only owners can invite people.")).toBeVisible();
  await expect(
    staffTab
      .getByRole("navigation", { name: "Settings sections", exact: true })
      .getByRole("link", { name: "Payouts", exact: true }),
  ).toHaveCount(0);
  const staffTeam = await (await staffTab.request.get("/api/v1/studio/team")).json();
  expect(staffTeam.team.map((m: { role: string }) => m.role).sort()).toEqual([
    "owner",
    "photographer",
  ]);

  // Saving a price list change ticks "Review your price list" (ADR 0019): the owner changes the home shipping fee.
  const lists = await (await page.request.get("/api/v1/price-lists")).json();
  const starter = lists.priceLists[0];
  // The local stack is the Canadian database (D122), so the list is in CAD (ADR 0006, 0019).
  expect(starter).toMatchObject({ name: "Starter price list", isDefault: true, currency: "CAD" });
  const shipping = await page.request.patch(`/api/v1/price-lists/${starter.id}`, {
    data: { homeShippingCents: 995 },
  });
  expect(shipping.status()).toBe(200);
  await page.goto("/app");
  await expect(setup.getByText("2 of 4 done", { exact: true })).toBeVisible();
  await expect(
    setup.getByRole("listitem").filter({ hasText: "Review your price list" }),
  ).toContainText("Done");

  // Payouts connected (ADR 0020), through the fake Stripe the end-to-end tests use: the owner's account is created,
  // "Stripe" finishes onboarding and tells Daybell by its signed webhook. phase1-payouts.spec.ts walks the screens.
  expect((await page.request.post("/api/v1/studio/payouts/onboarding-link")).status()).toBe(200);
  expect(
    (await page.request.post("/api/dev-stripe", { data: { action: "finish" } })).status(),
  ).toBe(200);
  await page.goto("/app");
  await expect(setup.getByText("3 of 4 done", { exact: true })).toBeVisible();

  // The first jobs complete the setup for good; Home then shows Up next, most urgent first: the job whose picture day
  // is 3 days away (in the browser's own day) before the one 40 days away (D143).
  const dayFromNow = (days: number) =>
    page.evaluate((n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      const pad = (v: number) => String(v).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }, days);
  for (const [name, days] of [
    [`Far ${tag}`, 40],
    [`Soon ${tag}`, 3],
  ] as const) {
    const res = await page.request.post("/api/v1/jobs", {
      data: { name, type: "school", pictureDay: await dayFromNow(days) },
    });
    expect(res.status()).toBe(201);
  }
  await page.goto("/app");
  const upNext = page.getByRole("region", { name: "Up next", exact: true });
  await expect(upNext.getByRole("listitem")).toHaveCount(2);
  await expect(upNext.getByRole("listitem").first()).toContainText("Add the roster");
  await expect(upNext.getByRole("listitem").first()).toContainText(
    `Soon ${tag} · Picture day in 3 days`,
  );
  await expect(upNext.getByRole("listitem").first().getByRole("link")).toHaveAttribute(
    "href",
    /^\/app\/jobs\/[0-9a-f-]{36}\/people$/,
  );
  await expect(upNext.getByRole("listitem").nth(1)).toContainText(`Far ${tag} · Next step`);
  await expect(setup).toHaveCount(0);
  // The photographer never sees the setup checklist; Up next is the same for them.
  await staffTab.goto("/app");
  const staffUpNext = staffTab.getByRole("region", { name: "Up next", exact: true });
  await expect(staffUpNext.getByRole("listitem").first()).toContainText(`Soon ${tag}`);
  await expect(staffTab.getByRole("region", { name: "Set up your studio" })).toHaveCount(0);

  // 5. A second studio sees nothing of the first.
  const other = `other-${tag}@example.test`;
  const outsider = await (await browser.newContext()).newPage();
  const signUp = await outsider.request.post("/api/v1/auth/sign-up", {
    data: {
      studioName: "Other Studio",
      studioSlug: `other-${tag}`.slice(0, 40),
      region: "ca",
      email: other,
    },
  });
  expect(signUp.status()).toBe(201);
  await outsider.goto(await linkFromEmail(other, VERIFY_LINK));
  await outsider.getByLabel("Password").fill(PASSWORD);
  await outsider.getByRole("button", { name: "Save and continue" }).click();
  await expect(outsider).toHaveURL(/\/app$/);
  const outsiderTeam = await (await outsider.request.get("/api/v1/studio/team")).json();
  expect(outsiderTeam.team.map((m: { email: string }) => m.email)).toEqual([other]);
  // Its Home checklist is its own: setup not done, and nothing of the first studio's jobs.
  const outsiderChecklist = await outsider.request.get("/api/v1/studio/checklist");
  expect(outsiderChecklist.status()).toBe(200);
  const theirs = await outsiderChecklist.json();
  expect(theirs.upNext).toBeNull();
  expect(JSON.stringify(theirs)).not.toContain(tag);
  // Reusing the photographer's invite link fails for anyone else.
  const steal = await outsider.request.post("/api/v1/invites/accept", {
    data: { token: inviteLink.split("#").pop() },
  });
  expect(steal.status()).toBe(403);

  // Cross-site writes are refused (CSRF), even with a valid session.
  const forged = await outsider.request.post("/api/v1/studio/invites", {
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    data: { email: "x@example.test", role: "staff" },
  });
  expect(forged.status()).toBe(403);

  // Owner signs out from the profile menu (their email and studio), then back in with their password.
  await page.getByRole("button", { name: owner }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // 6. Signed-out visitors are sent to sign in.
  const anonymous = await (await browser.newContext()).newPage();
  await anonymous.goto("/app");
  await expect(anonymous).toHaveURL(/\/sign-in\?next=%2Fapp/);
  expect((await anonymous.request.get("/api/v1/me")).status()).toBe(401);
});
