import { expect, test } from "@playwright/test";
import { studioSellingAva } from "./helpers";

// Phase 1 step 10 "Checkout", the studio's side (D59, D98, D104, D106; Seenu's answers 1, 2; Claude's calls 1, 3, 5, 6,
// 15; ADR 0023), on the desktop studio app with STRIPE_DRIVER=fake. The owner sets the business address and a GST/HST
// number in Settings › Taxes; a parent (through the API, as the phone spec does through the screens) buys a single
// download and pays at the fake hosted checkout; the job's Shop tab shows the order with its tax, Daybell's fee and the
// rate it used, Stripe's card fee and what reaches the studio, and its lines. Locators are scoped and exact.

const run = `${Date.now()}`;

test("orders and taxes: GST/HST registered, an order paid with tax, its fees on the job's Shop tab", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const tag = `${info.project.name}-${run}`;
  const baseURL = info.project.use.baseURL as string;
  const { context, page, jobId, code } = await studioSellingAva(browser, baseURL, tag);
  const main = page.getByRole("main");

  // 1. Settings › Taxes: the business address (Stripe's tax head office), then a GST/HST number (answer 2; call 3).
  await page.goto("/app/settings/taxes");
  await expect(
    main.getByRole("navigation", { name: "Settings sections", exact: true }).getByRole("link", {
      name: "Taxes",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    main.getByText("No registration means no tax is charged (small supplier).", { exact: true }),
  ).toBeVisible();
  await expect(main.getByText("Your shop doesn’t charge tax yet.", { exact: true })).toBeVisible();
  await main.getByLabel("Street address", { exact: true }).fill("12 Maple Lane");
  await main.getByLabel("City", { exact: true }).fill("Toronto");
  await main.getByLabel("Province or territory", { exact: true }).selectOption("ON");
  await main.getByLabel("Postal code", { exact: true }).fill("m5v 2t6");
  await main.getByRole("button", { name: "Save business address", exact: true }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "Business address saved." }),
  ).toBeVisible();
  await expect(main.getByText("Set, in Ontario.", { exact: true })).toBeVisible();
  await main.getByLabel("GST/HST number", { exact: true }).fill("123456789 RT 0001");
  await main.getByRole("button", { name: "Add GST/HST number", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Registration added." })).toBeVisible();
  await expect(main.getByText("123456789RT0001", { exact: true })).toBeVisible();
  await expect(main.getByText("Your shop charges tax at checkout.", { exact: true })).toBeVisible();

  // 2. A parent buys a single download and pays at the fake hosted checkout (no body is ever priced by the browser).
  const parent = await browser.newContext({ baseURL });
  const shop = parent.request;
  const opened = await shop.post("/api/v1/shop/access", { data: { code } });
  expect(opened.status()).toBe(201);
  const { childId, galleryId } = (await opened.json()) as { childId: string; galleryId: string };
  const q = `gallery=${galleryId}`;
  const portraits = (await (await shop.get(`/api/v1/shop/children/${childId}/gallery?${q}`)).json())
    .portraits as { id: string }[];
  const items = (await (await shop.get(`/api/v1/shop/children/${childId}/price-list?${q}`)).json())
    .priceList.items as { id: string; kind: string }[];
  const download = items.find((i) => i.kind === "digital_single");
  expect(
    (
      await shop.post(`/api/v1/shop/cart/lines?${q}`, {
        data: { childId, itemId: download?.id, photoId: portraits[0]?.id },
      })
    ).status(),
  ).toBe(201);
  const started = await shop.post(`/api/v1/shop/checkout?${q}`);
  expect(started.status()).toBe(201);
  const { url } = (await started.json()) as { url: string };
  const session = new URL(url).searchParams.get("session");
  const paid = await shop.post("/api/dev-stripe/checkout", {
    data: { action: "pay", session, email: `parent-${tag}@example.test`, shipping: null },
  });
  expect(paid.status()).toBe(200);
  await parent.close();

  // 3. The job's Shop tab: the order with its fees (D59, D98). $33.00 + 13% tax ($4.29) = $37.29; Daybell's 3% of the
  // product only ($0.99); the fake card fee 2.9% + 30¢ of $37.29 ($1.38); paid to the studio $34.92.
  await page.goto(`/app/jobs/${jobId}/shop`);
  const orders = main.getByRole("region", { name: "Orders", exact: true });
  const table = orders.getByRole("table", {
    name: "Paid orders for this job, newest first",
    exact: true,
  });
  const row = table.getByRole("row").nth(1);
  await expect(row.getByRole("cell", { name: "Ava Patel", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "$37.29", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "$4.29", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "$0.99 (3%)", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "$1.38", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "$34.92", exact: true })).toBeVisible();

  // 4. Its lines: what was sold, for whom.
  await row.getByRole("button", { name: /^Open order [0-9A-Z]{4}-[0-9A-Z]{4}$/ }).click();
  const dialog = page.getByRole("dialog", { name: /^Order [0-9A-Z]{4}-[0-9A-Z]{4}$/ });
  await expect(dialog.getByText("Digital download", { exact: true })).toBeVisible();
  await expect(dialog.getByText("For Ava Patel", { exact: true })).toBeVisible();
  await expect(dialog.getByText("None (downloads only)", { exact: true })).toBeVisible();
  await context.close();
});
