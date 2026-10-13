import { type Browser, expect, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import QRCode from "qrcode";
import sharp, { type OverlayOptions } from "sharp";
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

/**
 * The owner (signed in on `page`) invites `email` with `role`; the invitee creates an account from the invite link in
 * a new browser, confirms the email in a new tab and joins. Returns the invitee's signed-in tab at /app. Every locator
 * is scoped to the page's main landmark and matched exactly.
 */
export async function joinAs(
  page: Page,
  browser: Browser,
  email: string,
  role: string,
): Promise<Page> {
  const invite = await page.request.post("/api/v1/studio/invites", { data: { email, role } });
  expect(invite.status()).toBe(201);
  const joining = await (await browser.newContext()).newPage();
  await joining.goto((await invite.json()).link as string);
  const joiningMain = joining.getByRole("main");
  await joiningMain.getByRole("link", { name: "Create account", exact: true }).click();
  await joiningMain.getByLabel("Your email", { exact: true }).fill(email);
  await joiningMain.getByRole("button", { name: "Email me a link", exact: true }).click();
  await expect(
    joiningMain.getByRole("heading", { name: "Check your inbox", exact: true }),
  ).toBeVisible();
  const tab = await joining.context().newPage();
  await tab.goto(await linkFromEmail(email, VERIFY_LINK));
  await joining.close();
  const tabMain = tab.getByRole("main");
  await tabMain.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await tabMain.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(tab).toHaveURL(/\/invite$/);
  await tabMain.getByRole("button", { name: "Join the team", exact: true }).click();
  await expect(tab).toHaveURL(/\/app$/);
  return tab;
}

/**
 * A 24-megapixel photo with a plain background of its own (so no two files are the same), and maybe a card: a QR
 * holding `payload` (as printed cards do), optionally with its middle covered (finder patterns still visible).
 */
export async function photo(seed: number, card?: { payload: string; damaged?: boolean }) {
  const background = { r: (seed * 37) % 256, g: (seed * 91) % 256, b: 120 };
  const layers: OverlayOptions[] = [];
  if (card) {
    let png = await QRCode.toBuffer(card.payload, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 300,
    });
    if (card.damaged)
      png = await sharp(png)
        .composite([
          {
            input: { create: { width: 210, height: 75, channels: 3, background: "#000" } },
            left: 45,
            top: 112,
          },
        ])
        .png()
        .toBuffer();
    layers.push({ input: png, left: 2600, top: 2300 });
  }
  return sharp({ create: { width: 6000, height: 4000, channels: 3, background } })
    .composite(layers)
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** The job's card codes, read through the Data API as the signed-in owner (row-level security; ADR 0015). */
export async function cardCodes(page: Page, jobId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL_CA;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_CA;
  if (!url || !key)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL_CA and _PUBLISHABLE_KEY_CA are needed");
  const jar = await page.context().cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.map((c) => ({ name: c.name, value: c.value })), setAll: () => {} },
  });
  const { data, error } = await supabase
    .from("qr_cards")
    .select("id, child_id, card_code")
    .eq("job_id", jobId);
  if (error) throw new Error(error.message);
  return data as { id: string; child_id: string | null; card_code: string }[];
}
