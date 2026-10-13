import { type Download, expect, type Page, test } from "@playwright/test";
import { studioSellingAva } from "./helpers";

// Phase 1 step 11 "Orders and refunds", the parent's side (D25, D24; Seenu's answer 2, Q5, Q6; ADR 0024), on a phone
// (Pixel 7) with STORAGE_DRIVER=local and STRIPE_DRIVER=fake. A parent pays a print and two downloads delivered home:
// the bag badge is empty as soon as the order page opens (step 10's stale badge); Download all saves one zip named by
// the order, never the child; once the studio ships it, the order shows Shipped with its tracking and a link. A second
// order, a print delivered to school, is canceled by the parent before it is printed: a full refund. Locators are
// scoped to a landmark or a dialog, and exact.
test.use({ reducedMotion: "reduce" });

const run = `${Date.now()}`;

async function enterCode(page: Page, code: string) {
  const main = page.getByRole("main");
  await main.getByLabel("Access code", { exact: true }).fill(code);
  await main.getByRole("button", { name: "View photos", exact: true }).click();
}

test("parent orders: bag badge, Download all, tracking once shipped, cancel before printing", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000);
  const tag = `${info.project.name}-${run}`;
  const baseURL = info.project.use.baseURL as string;
  const studio = await studioSellingAva(browser, baseURL, tag);
  const main = page.getByRole("main");
  const header = page.getByRole("banner");
  const docked = page.getByRole("region", { name: "Next step", exact: true });

  // 1. The code; then the bag filled through the shop's API in this browser (the screens are the checkout spec's).
  await page.goto("/shop");
  await enterCode(page, studio.code);
  await expect(main.getByRole("heading", { name: "Ava P.", level: 1, exact: true })).toBeVisible();
  // The code opens the full-screen cover first; the bar with the bag comes with the grid.
  await main.getByRole("button", { name: "See photos", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Ava P.", level: 1, exact: true }),
  ).toBeVisible();
  const bagLink = header.getByRole("link", { name: "Bag, empty", exact: true });
  const bagHref = (await bagLink.getAttribute("href")) as string;
  const galleryId = new URL(bagHref, baseURL).searchParams.get("gallery") as string;
  const childId = /\/shop\/c\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
  const q = `gallery=${galleryId}`;
  const shop = page.request;
  const portraits = (await (await shop.get(`/api/v1/shop/children/${childId}/gallery?${q}`)).json())
    .portraits as { id: string }[];
  const items = (await (await shop.get(`/api/v1/shop/children/${childId}/price-list?${q}`)).json())
    .priceList.items as { id: string; kind: string; name: string }[];
  const print = items.find((i) => i.name === "5×7 print")?.id as string;
  const download = items.find((i) => i.kind === "digital_single")?.id as string;
  for (const [itemId, photo] of [
    [print, 0],
    [download, 0],
    [download, 1],
  ] as const)
    expect(
      (
        await shop.post(`/api/v1/shop/cart/lines?${q}`, {
          data: { childId, itemId, photoId: portraits[photo]?.id },
        })
      ).status(),
    ).toBe(201);

  // 2. The bag: home delivery, Pay; "Stripe" takes the test card; the order page's badge is right at once.
  await page.goto(bagHref);
  await expect(header.getByRole("link", { name: "Bag, 3 items", exact: true })).toBeVisible();
  await main
    .getByRole("group", { name: "Delivery", exact: true })
    .getByRole("radio", { name: "Home delivery", exact: true })
    .check();
  await docked.getByRole("button", { name: "Pay securely", exact: true }).click();
  await expect(page).toHaveURL(/\/dev\/stripe-checkout\?session=cs_test_fake/);
  const stripe = page.getByRole("main");
  await stripe.getByLabel("Email", { exact: true }).fill(`parent-${tag}@example.test`);
  await stripe.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page).toHaveURL(/\/shop\/orders\/[0-9a-f-]{36}\?gallery=/);
  const orderUrl = page.url();
  const orderId = /\/shop\/orders\/([0-9a-f-]{36})/.exec(orderUrl)?.[1] as string;
  await expect(
    main.getByRole("heading", { name: "Thank you!", level: 2, exact: true }),
  ).toBeVisible();
  await expect(header.getByRole("link", { name: "Bag, empty", exact: true })).toBeVisible();
  await expect(main.getByText("Status: Paid", { exact: true })).toBeVisible();

  // 3. Download all: one zip named by the order. The files are made once paid, so a first tap may be told to wait.
  await expect(async () => {
    const saving: Promise<Download> = page.waitForEvent("download", { timeout: 5_000 });
    await main.getByRole("button", { name: "Download all", exact: true }).click();
    const file = await saving;
    expect(file.suggestedFilename()).toMatch(/^daybell-[0-9A-Z]{8}\.zip$/);
  }).toPass({ intervals: [2_000, 3_000], timeout: 90_000 });
  await expect(
    main.getByRole("status").filter({ hasText: "Your photos are downloading as one zip file." }),
  ).toBeVisible();

  // 4. The studio prints and ships it with Canada Post; the parent sees Shipped, the tracking and its link.
  const studioApi = studio.page.request;
  expect(
    (
      await studioApi.post(`/api/v1/orders/${orderId}/status`, { data: { status: "printed" } })
    ).status(),
  ).toBe(200);
  expect(
    (
      await studioApi.post(`/api/v1/orders/${orderId}/status`, {
        data: { status: "shipped", carrier: "canada_post", trackingNumber: "7023456789012345" },
      })
    ).status(),
  ).toBe(200);
  await studio.context.close();
  await page.reload();
  await expect(main.getByText("Status: Shipped", { exact: true })).toBeVisible();
  await expect(
    main.getByText("Tracking: Canada Post: 7023456789012345", { exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Track your package (opens in a new tab)", exact: true }),
  ).toHaveAttribute("href", /^https:\/\/www\.canadapost-postescanada\.ca\//);
  // Printed: the parent can no longer cancel (answer 2).
  await expect(main.getByRole("button", { name: "Cancel order", exact: true })).toHaveCount(0);

  // 5. A second order, a print delivered to school, paid from this browser; canceled before it is printed.
  expect(
    (
      await shop.post(`/api/v1/shop/cart/lines?${q}`, {
        data: { childId, itemId: print, photoId: portraits[1]?.id },
      })
    ).status(),
  ).toBe(201);
  expect(
    (await shop.put(`/api/v1/shop/cart/shipping?${q}`, { data: { method: "school" } })).status(),
  ).toBe(200);
  const started = await shop.post(`/api/v1/shop/checkout?${q}`);
  expect(started.status()).toBe(201);
  const session = new URL(((await started.json()) as { url: string }).url).searchParams.get(
    "session",
  );
  const paid = await shop.post("/api/dev-stripe/checkout", {
    data: { action: "pay", session, email: `parent-${tag}@example.test`, shipping: null },
  });
  expect(paid.status()).toBe(200);
  await page.goto(((await paid.json()) as { redirect: string }).redirect);
  await expect(main.getByText("Status: Paid", { exact: true })).toBeVisible();
  await expect(
    main.getByText("You can cancel for a full refund until the studio prints your order.", {
      exact: true,
    }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Cancel order", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Cancel this order?", exact: true });
  await expect(confirm.getByText(/^You’ll get \$\d+\.\d{2} back on your card/)).toBeVisible();
  await confirm.getByRole("button", { name: "Yes, cancel and refund", exact: true }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "Your order was canceled and refunded." }),
  ).toBeVisible();
  await expect(main.getByText("Status: Canceled · Refunded", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Cancel order", exact: true })).toHaveCount(0);
  // The first order still has its downloads.
  await page.goto(orderUrl);
  await expect(main.getByRole("button", { name: "Download all", exact: true })).toBeVisible();
});
