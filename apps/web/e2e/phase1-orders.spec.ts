import { type APIRequestContext, expect, test } from "@playwright/test";
import { studioSellingAva } from "./helpers";

// Phase 1 step 11 "Orders and refunds" (D25, D59, D127, D96; Seenu's answers 1–4, Q1–Q4; ADR 0024), the studio's side
// on the desktop app with STRIPE_DRIVER=fake. A parent (through the API; the phone spec uses the screens) pays two
// orders: A, a 5×7 print and a download delivered home; B, a 5×7 print delivered to school. Done-when item 7: the owner
// marks A printed then shipped with tracking, B printed and delivered to school with the bulk bar, and refunds part of
// A (its download). Item 8: the sale on Home, the bell, the ledger's refund lines and the activity. No tax is set, so a
// $33.00 download refunds $33.00; Daybell's 3% of it ($0.99) goes back to the studio, which gives back $32.01.
// Locators are scoped to main, a region or a dialog, and exact.

const run = `${Date.now()}`;
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const formatted = (reference: string) => `${reference.slice(0, 4)}-${reference.slice(4)}`;

/** A parent's paid order through the shop's API and the fake hosted checkout: its id and formatted reference. */
async function buy(
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

test("orders: printed then shipped with tracking, bulk delivered to school, a partial refund, the ledger, Home, bell and activity", async ({
  browser,
}, info) => {
  test.setTimeout(360_000);
  const tag = `${info.project.name}-${run}`;
  const baseURL = info.project.use.baseURL as string;
  const { context, page, code } = await studioSellingAva(browser, baseURL, tag);
  const main = page.getByRole("main");

  // 1. The parent's two orders.
  const parent = await browser.newContext({ baseURL });
  const shop = parent.request;
  const opened = await shop.post("/api/v1/shop/access", { data: { code } });
  expect(opened.status()).toBe(201);
  const { childId, galleryId } = (await opened.json()) as { childId: string; galleryId: string };
  const q = `gallery=${galleryId}`;
  const portraits = (await (await shop.get(`/api/v1/shop/children/${childId}/gallery?${q}`)).json())
    .portraits as { id: string }[];
  const items = (await (await shop.get(`/api/v1/shop/children/${childId}/price-list?${q}`)).json())
    .priceList.items as { id: string; kind: string; name: string }[];
  const print = items.find((i) => i.name === "5×7 print")?.id as string;
  const download = items.find((i) => i.kind === "digital_single")?.id as string;
  const pose1 = portraits[0]?.id as string;
  const pose2 = portraits[1]?.id as string;
  const a = await buy(
    shop,
    q,
    [
      { childId, itemId: print, photoId: pose1 },
      { childId, itemId: download, photoId: pose2 },
    ],
    "home",
    tag,
  );
  const b = await buy(shop, q, [{ childId, itemId: print, photoId: pose1 }], "school", tag);
  await parent.close();

  // 2. Orders: both paid, newest first, by reference; children by first name and last initial.
  await page.goto("/app/orders");
  await expect(main.getByRole("heading", { name: "Orders", level: 1, exact: true })).toBeVisible();
  const table = main.getByRole("table", { name: "Paid orders, newest first", exact: true });
  const rowA = table
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: a.reference, exact: true }) });
  const rowB = table
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: b.reference, exact: true }) });
  await expect(rowA.getByRole("cell", { name: "Home delivery", exact: true })).toBeVisible();
  await expect(rowB.getByRole("cell", { name: "Delivery to school", exact: true })).toBeVisible();
  await expect(rowB.getByRole("cell", { name: "Ava P.", exact: true })).toBeVisible();
  await expect(rowB.getByText("Paid", { exact: true })).toBeVisible();

  // 3. Bulk: B printed, then delivered to school, each result announced (answer 4).
  const bar = main.getByRole("region", { name: "Selected orders", exact: true });
  const announced = main.getByRole("status").filter({ hasText: "1 order changed." });
  await rowB.getByRole("checkbox", { name: `Select order ${b.reference}`, exact: true }).check();
  await expect(bar.getByText("1 order selected", { exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "Mark printed", exact: true }).click();
  await expect(announced).toBeVisible();
  await expect(rowB.getByText("Printed", { exact: true })).toBeVisible();
  await rowB.getByRole("checkbox", { name: `Select order ${b.reference}`, exact: true }).check();
  await bar.getByRole("button", { name: "Mark delivered to school", exact: true }).click();
  await expect(rowB.getByText("Delivered to school", { exact: true })).toBeVisible();

  // 4. A: printed, then shipped with a UPS tracking number.
  await rowA.getByRole("link", { name: a.reference, exact: true }).click();
  await expect(
    main.getByRole("heading", { name: `Order ${a.reference}`, level: 1, exact: true }),
  ).toBeVisible();
  const progress = main.getByRole("region", { name: "Progress", exact: true });
  await progress.getByRole("button", { name: "Mark printed", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Marked printed." })).toBeVisible();
  await progress.getByRole("button", { name: "Mark shipped", exact: true }).click();
  const ship = page.getByRole("dialog", { name: "Mark shipped", exact: true });
  await ship.getByLabel("Carrier", { exact: true }).selectOption({ label: "UPS" });
  await ship.getByLabel("Tracking number", { exact: true }).fill("1z999aa10123456784");
  await ship.getByRole("button", { name: "Mark shipped", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Marked shipped." })).toBeVisible();
  await expect(progress.getByText("UPS: 1Z999AA10123456784", { exact: true })).toBeVisible();
  await expect(
    progress.getByRole("link", { name: "Track this package (opens in a new tab)", exact: true }),
  ).toHaveAttribute("href", /^https:\/\/www\.ups\.com\//);

  // 5. A partial refund: the download (Q1, Q3). Refunds open once Stripe's fee is known.
  const refunds = main.getByRole("region", { name: "Refunds", exact: true });
  await expect(async () => {
    await page.reload();
    await expect(refunds.getByRole("button", { name: "Refund", exact: true })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await refunds.getByRole("button", { name: "Refund", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Refund order ${a.reference}`, exact: true });
  await dialog.getByLabel("Refund how many of Digital download", { exact: true }).fill("1");
  await dialog.getByLabel("Reason", { exact: true }).selectOption({ label: "Damaged" });
  const summary = dialog.getByRole("region", { name: "Summary", exact: true });
  await expect(summary.getByText("$0.99", { exact: true })).toBeVisible();
  await expect(summary.getByText("$32.01", { exact: true })).toBeVisible();
  await expect(
    summary.getByText("Stripe’s card fee isn’t returned.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Review refund", exact: true }).click();
  await dialog.getByRole("button", { name: "Refund $33.00", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Refunded $33.00." })).toBeVisible();
  await expect(main.getByText("Partly refunded", { exact: true }).first()).toBeVisible();
  const history = refunds.getByRole("table", { name: "Refunds of this order", exact: true });
  const refundRow = history.getByRole("row").nth(1);
  await expect(refundRow.getByRole("cell", { name: "Damaged", exact: true })).toBeVisible();
  await expect(refundRow.getByRole("cell", { name: "$33.00", exact: true })).toBeVisible();
  await expect(refundRow.getByRole("cell", { name: "Refunded", exact: true })).toBeVisible();
  await expect(main.getByText("1 refunded", { exact: true })).toBeVisible();

  // 6. The ledger: the sale, then the refund's lines, which add up to zero (ADR 0006).
  const ledger = main
    .getByRole("region", { name: "Money and ledger", exact: true })
    .getByRole("table", { name: "This order’s ledger transactions", exact: true });
  await expect(ledger.getByRole("cell", { name: "Sale", exact: true })).toBeVisible();
  await expect(ledger.getByRole("cell", { name: "Refund", exact: true })).toBeVisible();
  await expect(ledger.getByRole("cell", { name: "$32.01", exact: true })).toBeVisible();
  await expect(ledger.getByRole("cell", { name: "$0.99", exact: true })).toBeVisible();

  // 7. Home: today's two orders; nothing left to do; the activity.
  await page.goto("/app");
  const today = main.getByRole("region", { name: "Today", exact: true });
  await expect(today.getByText("Orders", { exact: true })).toBeVisible();
  await expect(today.getByText("2", { exact: true })).toBeVisible();
  await expect(
    main
      .getByRole("region", { name: "To do", exact: true })
      .getByText("No orders are waiting.", { exact: true }),
  ).toBeVisible();
  await expect(main.getByText(new RegExp(`shipped order ${literal(a.reference)}$`))).toBeVisible();
  await expect(main.getByText(new RegExp(`refunded order ${literal(a.reference)}$`))).toBeVisible();
  await expect(
    main.getByText(new RegExp(`marked order ${literal(b.reference)} delivered to school$`)),
  ).toBeVisible();

  // 8. The bell: a new order rings it, and the row opens the order.
  const menu = page.getByRole("complementary", { name: "Studio menu", exact: true });
  await menu.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  const rung = menu.getByRole("link", {
    name: new RegExp(`^Unread, New order ${literal(a.reference)}`),
  });
  await expect(rung).toBeVisible();
  await rung.click();
  await expect(page).toHaveURL(new RegExp(`/app/orders/${a.orderId}$`));
  await context.close();
});

// Step 10's taxes and fees (ADR 0023), now on the job's Orders tab and the order page (ADR 0024).
test("orders and taxes: GST/HST registered, an order paid with tax, its fees on the order page", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const tag = `${info.project.name}-t${run}`;
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

  // 3. The job's Orders tab and the order page: its fees (D59, D98). $33.00 + 13% tax ($4.29) = $37.29; Daybell's 3%
  // of the product only ($0.99); the fake card fee 2.9% + 30¢ of $37.29 ($1.38); paid to the studio $34.92.
  await page.goto(`/app/jobs/${jobId}/orders`);
  const table = main.getByRole("table", {
    name: "This job’s paid orders, newest first",
    exact: true,
  });
  const row = table.getByRole("row").nth(1);
  await expect(row.getByRole("cell", { name: "Ava P.", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "$37.29", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "Downloads only", exact: true })).toBeVisible();
  await expect(row.getByText("Complete", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: /^[0-9A-Z]{4}-[0-9A-Z]{4}$/ }).click();
  const totals = main.getByRole("region", { name: "Totals and fees", exact: true });
  await expect(totals.getByText("$4.29", { exact: true })).toBeVisible();
  await expect(totals.getByText("$0.99 (3%)", { exact: true })).toBeVisible();
  await expect(totals.getByText("$1.38", { exact: true })).toBeVisible();
  await expect(totals.getByText("$34.92", { exact: true })).toBeVisible();

  // 4. Its lines: what was sold, for whom.
  const lines = main.getByRole("region", { name: "Items", exact: true });
  await expect(lines.getByText("Digital download", { exact: true })).toBeVisible();
  await expect(lines.getByText("For Ava Patel", { exact: true })).toBeVisible();
  await context.close();
});
