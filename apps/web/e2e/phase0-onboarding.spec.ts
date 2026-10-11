import { expect, test } from "@playwright/test";
import { linkFromEmail } from "./mail";

// Phase 0 "Done when" (steps 1, 2, 5): sign up a studio, confirm the email, invite staff, staff joins with a role,
// and a second studio sees nothing of the first. Unique emails per run and per device project.
const run = `${Date.now()}`;
const VERIFY_LINK = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/;
const PASSWORD = "correct horse battery staple";

test("owner signs up, invites a photographer, and studios stay separate", async ({
  page,
  browser,
}, info) => {
  const tag = `${info.project.name}-${run}`;
  const owner = `owner-${tag}@example.test`;
  const photographer = `photographer-${tag}@example.test`;
  const slug = `north-peak-${tag}`.slice(0, 40).replace(/-+$/, "");

  // 1. Owner signs up.
  await page.goto("/sign-up");
  await page.getByLabel("Studio name").fill(`North Peak ${tag}`);
  await page.getByLabel("Studio web address").fill(slug);
  await page.getByLabel("Your email").fill(owner);
  await expect(page.getByText("Your studio's data will be stored in Canada.")).toBeVisible();
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  // 2. Confirms the email, chooses a password, and lands in their new studio.
  await page.goto(await linkFromEmail(owner, VERIFY_LINK));
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: `Welcome to North Peak ${tag}` })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Owner/ })).toBeVisible();

  // 3. Invites a photographer and gets a link.
  await page.getByLabel("Their email").fill(photographer);
  await page.getByLabel("Role").selectOption("photographer");
  await page.getByRole("button", { name: "Create invite" }).click();
  const inviteLink = (await page.locator("code").textContent())?.trim() ?? "";
  expect(inviteLink).toMatch(/\/invite#[0-9a-f]{64}$/);
  await expect(page.getByText("Waiting to join")).toBeVisible();

  // 4. The photographer, in a fresh browser, creates an account from the invite and joins.
  const staff = await (await browser.newContext()).newPage();
  await staff.goto(inviteLink);
  await staff.getByRole("link", { name: "Create account" }).click();
  await staff.getByLabel("Your email").fill(photographer);
  await staff.getByRole("button", { name: "Email me a link" }).click();
  await expect(staff.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await staff.goto(await linkFromEmail(photographer, VERIFY_LINK));
  await staff.getByLabel("Password").fill(PASSWORD);
  await staff.getByRole("button", { name: "Save and continue" }).click();
  await expect(staff).toHaveURL(/\/invite$/);
  await staff.getByRole("button", { name: "Join the team" }).click();
  await expect(staff).toHaveURL(/\/app$/);
  await expect(staff.getByRole("heading", { name: `Welcome to North Peak ${tag}` })).toBeVisible();
  // Photographers see the team but cannot invite.
  await expect(staff.getByText("Only owners can invite people.")).toBeVisible();
  const staffTeam = await (await staff.request.get("/api/v1/studio/team")).json();
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

  // 6. Signed-out visitors are sent to sign in.
  const anonymous = await (await browser.newContext()).newPage();
  await anonymous.goto("/app");
  await expect(anonymous).toHaveURL(/\/sign-in\?next=%2Fapp/);
  expect((await anonymous.request.get("/api/v1/me")).status()).toBe(401);
});
