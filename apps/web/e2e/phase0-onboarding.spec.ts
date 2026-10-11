import { expect, test } from "@playwright/test";
import { PASSWORD, VERIFY_LINK } from "./helpers";
import { linkFromEmail } from "./mail";

// Phase 0 "Done when" (steps 1, 2, 5): sign up a studio, confirm the email, invite staff, staff joins with a role,
// and a second studio sees nothing of the first. Unique emails per run and per device project.
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
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  const phone = info.project.name === "phone";

  // Every section is reachable; unbuilt ones say "Soon" (D126, D128). Phones use bottom tabs plus a "More" sheet.
  if (phone) {
    await page.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByRole("dialog", { name: "More" }).getByRole("link", { name: /Contacts/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Contacts/ }),
    ).toBeVisible();
  }
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /Orders/ })
    .click();
  await expect(page.getByRole("heading", { name: "Orders is coming soon" })).toBeVisible();

  // 3. From "Needs you", goes to Settings and invites a photographer.
  await page.goto("/app");
  await page.getByRole("link", { name: /Invite your team/ }).click();
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

  // Home now shows the team step done, and the activity log has all three changes (event log, D96).
  await page.goto("/app");
  await expect(page.getByText("Brand your shop")).toBeVisible();
  await expect(page.getByRole("link", { name: /Invite your team/ })).toHaveCount(0);
  await expect(page.getByText(`${owner} withdrew an invite`)).toBeVisible();
  await expect(page.getByText(`${owner} invited someone as photographer`).first()).toBeVisible();

  // ⌘K search jumps between sections.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search" }).fill("sett");
  await page.keyboard.press("Enter");
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
  // Photographers see the team but cannot invite.
  await staffTab.goto("/app/settings");
  await expect(staffTab.getByText("Only owners can invite people.")).toBeVisible();
  const staffTeam = await (await staffTab.request.get("/api/v1/studio/team")).json();
  expect(staffTeam.team.map((m: { role: string }) => m.role).sort()).toEqual([
    "owner",
    "photographer",
  ]);

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

  // Owner signs out (account menu on desktop, "More" on phones), then back in with their password.
  await page.getByRole("button", { name: phone ? "More" : "Account" }).click();
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
