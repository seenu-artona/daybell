import { expect, type Page } from "@playwright/test";
import { linkFromEmail } from "./mail";

// Our email templates link to /auth/confirm with a token_hash, so links work in any tab, browser or device.
export const VERIFY_LINK = /https?:\/\/[^\s"'<>]+\/auth\/confirm\?[^\s"'<>]*token_hash=[^\s"'<>]*/;
export const PASSWORD = "correct horse battery staple";

/**
 * Signs up a new studio through the screens, confirms the email in a new tab (as from a mail app) and chooses a
 * password. Returns the tab that is now signed in at /app.
 */
export async function signUpOwner(
  page: Page,
  { studio, slug, email }: { studio: string; slug: string; email: string },
): Promise<Page> {
  await page.goto("/sign-up");
  await page.getByLabel("Studio name").fill(studio);
  await page.getByLabel("Studio web address").fill(slug);
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const confirmTab = await page.context().newPage();
  await confirmTab.goto(await linkFromEmail(email, VERIFY_LINK));
  await page.close();
  await expect(confirmTab.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await confirmTab.getByLabel("Password").fill(PASSWORD);
  await confirmTab.getByRole("button", { name: "Save and continue" }).click();
  await expect(confirmTab).toHaveURL(/\/app$/);
  return confirmTab;
}
