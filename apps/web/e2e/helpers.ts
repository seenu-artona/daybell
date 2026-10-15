import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";
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

/**
 * A studio selling one job with one child, Ava Patel, and three of her photos tagged by her card (ADR 0022, 0023): its
 * owner signed in on a desktop-sized page (the studio app is desktop only, D136), payouts Active through the fake
 * Stripe, delivery to school on. The caller closes the context.
 */
export async function studioSellingAva(
  browser: Browser,
  baseURL: string,
  tag: string,
): Promise<{ context: BrowserContext; page: Page; studio: string; jobId: string; code: string }> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const studio = `Riverside Photo ${tag}`;
  const page = await signUpOwner(await context.newPage(), {
    studio,
    slug: `pay-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `pay-owner-${tag}@example.test`,
  });
  const pastDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Fall Portraits ${tag}`, type: "school", pictureDay: pastDay },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  const added = await page.request.post(`/api/v1/jobs/${jobId}/children`, {
    data: { firstName: "Ava", lastName: "Patel" },
  });
  expect(added.status()).toBe(201);
  const child = (await added.json()).child as { id: string; accessCode: string };
  expect((await page.request.post(`/api/v1/jobs/${jobId}/qr-cards`, { data: {} })).status()).toBe(
    200,
  );
  const card = (await cardCodes(page, jobId)).find((c) => c.child_id === child.id)?.card_code ?? "";
  const day = join(mkdtempSync(join(tmpdir(), "daybell-pay-")), "Picture day");
  mkdirSync(day);
  writeFileSync(join(day, "IMG_0001.JPG"), await photo(21, { payload: `DBC1:${card}` }));
  writeFileSync(join(day, "IMG_0002.JPG"), await photo(22));
  writeFileSync(join(day, "IMG_0003.JPG"), await photo(23));
  const main = page.getByRole("main");
  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = main.getByRole("region", { name: "Upload photos", exact: true });
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(day);
  await expect(sheet.getByText("Done: 3 photos added", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await page.goto(`/app/jobs/${jobId}/photos?show=review`);
  await expect(
    main.getByText("3 photos · 0 in Leftovers · 0 to check", { exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  expect((await page.request.post(`/api/v1/jobs/${jobId}/tagging/review`)).status()).toBe(200);
  expect(
    (
      await page.request.patch(`/api/v1/jobs/${jobId}`, { data: { deliverToSchool: true } })
    ).status(),
  ).toBe(200);
  expect((await page.request.post("/api/v1/studio/payouts/onboarding-link")).status()).toBe(200);
  expect(
    (await page.request.post("/api/dev-stripe", { data: { action: "finish" } })).status(),
  ).toBe(200);
  expect((await page.request.post(`/api/v1/jobs/${jobId}/start-selling`)).status()).toBe(200);
  return { context, page, studio, jobId, code: child.accessCode };
}

const formatted = (reference: string) => `${reference.slice(0, 4)}-${reference.slice(4)}`;

/** A parent's paid order through the shop's API and the fake hosted checkout: its id and formatted reference. */
export async function buy(
  shop: APIRequestContext,
  q: string,
  lines: { childId: string; itemId: string; photoId: string }[],
  method: "home" | "school",
  tag: string,
) {
  for (const line of lines)
    expect((await shop.post(`/api/v1/shop/cart/lines?${q}`, { data: line })).status()).toBe(201);
  expect((await shop.put(`/api/v1/shop/cart/shipping?${q}`, { data: { method } })).status()).toBe(
    200,
  );
  const started = await shop.post(`/api/v1/shop/checkout?${q}`);
  expect(started.status()).toBe(201);
  const session = new URL(((await started.json()) as { url: string }).url).searchParams.get(
    "session",
  );
  const paid = await shop.post("/api/dev-stripe/checkout", {
    data: {
      action: "pay",
      session,
      email: `parent-${tag}@example.test`,
      shipping:
        method === "home"
          ? {
              name: "Priya Patel",
              line1: "12 Maple Lane",
              line2: null,
              city: "Toronto",
              state: "ON",
              postalCode: "M5V 2T6",
              country: "CA",
            }
          : null,
    },
  });
  expect(paid.status()).toBe(200);
  const orderId = /\/shop\/orders\/([0-9a-f-]{36})/.exec(
    ((await paid.json()) as { redirect: string }).redirect,
  )?.[1] as string;
  const order = (await (await shop.get(`/api/v1/shop/orders/${orderId}?${q}`)).json()) as {
    order: { reference: string };
  };
  return { orderId, reference: formatted(order.order.reference) };
}
