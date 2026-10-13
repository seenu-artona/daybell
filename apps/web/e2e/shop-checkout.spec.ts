import { type Download, expect, type Page, test } from "@playwright/test";
import { studioSellingAva } from "./helpers";

// Phase 1 step 10 "Checkout" (D59, D96, D97, D104, D106, D24; Seenu's answers 1–4, Claude's calls 1–20; ADR 0023), on a
// phone (Pixel 7), with STORAGE_DRIVER=local and STRIPE_DRIVER=fake (its hosted checkout is /dev/stripe-checkout, which
// tells Daybell through the real webhook). The Phase 1 goal: a parent opens a code, buys a package, a print and a
// download, and pays with a test card. Then: the confirmation page's downloads (a JPEG saved as a file named by the
// order, never by the child), a checkout left without paying (the bag unchanged), and, on a forgotten device, the code
// again and "Your orders" with the downloads. Locators are scoped to a landmark and exact.
test.use({ reducedMotion: "reduce" });

const run = `${Date.now()}`;

async function enterCode(page: Page, code: string) {
  const main = page.getByRole("main");
  await main.getByLabel("Access code", { exact: true }).fill(code);
  await main.getByRole("button", { name: "View photos", exact: true }).click();
}

test("checkout: package, print and download paid with a test card; downloads; cancel; Your orders after forgetting", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000);
  const tag = `${info.project.name}-${run}`;
  const baseURL = info.project.use.baseURL as string;
  const studio = await studioSellingAva(browser, baseURL, tag);
  await studio.context.close();
  const main = page.getByRole("main");
  const header = page.getByRole("banner");
  const docked = page.getByRole("region", { name: "Next step", exact: true });

  // 1. The code, the cover, the photos.
  await page.goto("/shop");
  await enterCode(page, studio.code);
  await expect(main.getByRole("heading", { name: "Ava P.", level: 1, exact: true })).toBeVisible();
  await main.getByRole("button", { name: "See photos", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Ava P.", level: 1, exact: true }),
  ).toBeVisible();

  // 2. A package (with its digital), its pose; then a 5×7 print and a single download of the second pose.
  await docked.getByRole("link", { name: "Choose a package", exact: true }).click();
  await main.getByRole("radio", { name: "Package A", exact: true }).check();
  await docked.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Package A", level: 1, exact: true }),
  ).toBeVisible();
  await docked.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();
  for (const item of ["5×7 print", "Digital download"]) {
    await header.getByRole("link", { name: "Back", exact: true }).click();
    await docked.getByRole("link", { name: "Choose a package", exact: true }).click();
    await main.getByRole("link", { name: "Single prints and downloads", exact: true }).click();
    await main.getByRole("radio", { name: item, exact: true }).check();
    await docked.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(header.getByRole("heading", { name: item, level: 1, exact: true })).toBeVisible();
    if (item === "Digital download")
      await main
        .getByRole("group", { name: "Pose", exact: true })
        .getByRole("radio", { name: "Pose 2 of 2", exact: true })
        .check();
    await docked.getByRole("button", { name: "Add to bag", exact: true }).click();
    await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();
  }

  // 3. The bag: Pay waits for delivery and says why; home delivery; the D104 line; Pay.
  await expect(header.getByRole("link", { name: "Bag, 3 items", exact: true })).toBeVisible();
  await expect(docked.getByText("Choose delivery to pay.", { exact: true })).toBeVisible();
  await main
    .getByRole("group", { name: "Delivery", exact: true })
    .getByRole("radio", { name: "Home delivery", exact: true })
    .check();
  // Package A $85.00 + 5×7 $19.00 + download $33.00 + home delivery $11.95, before tax.
  await expect(main.getByText("Total $148.95", { exact: true })).toBeVisible();
  await expect(
    main.getByText(`Payments processed by Daybell for ${studio.studio}.`, { exact: true }),
  ).toBeVisible();
  await docked.getByRole("button", { name: "Pay securely", exact: true }).click();

  // 4. "Stripe's" hosted checkout (the fake): the order as Daybell sent it, an email and a test card, the address.
  await expect(page).toHaveURL(/\/dev\/stripe-checkout\?session=cs_test_fake/);
  const stripe = page.getByRole("main");
  await expect(
    stripe.getByRole("heading", { name: studio.studio, level: 1, exact: true }),
  ).toBeVisible();
  await expect(stripe.getByText("Package A × 1", { exact: true })).toBeVisible();
  await expect(stripe.getByText("Home delivery", { exact: true })).toBeVisible();
  // Never a child's name at Stripe.
  await expect(stripe).not.toContainText("Ava");
  await stripe.getByLabel("Email", { exact: true }).fill(`parent-${tag}@example.test`);
  await expect(stripe.getByLabel("Card number", { exact: true })).toHaveValue(
    "4242 4242 4242 4242",
  );
  await stripe.getByRole("button", { name: "Pay", exact: true }).click();

  // 5. The order page: paid (the webhook came first), the reference, the receipt line, a button per download.
  await expect(page).toHaveURL(/\/shop\/orders\/[0-9a-f-]{36}\?gallery=/);
  await expect(
    header.getByRole("heading", { name: "Your order", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Your order");
  await expect(
    main.getByRole("heading", { name: "Thank you!", level: 2, exact: true }),
  ).toBeVisible();
  await expect(main.getByText(/^Order [0-9A-Z]{4}-[0-9A-Z]{4}$/)).toBeVisible();
  await expect(main.getByText("Stripe emails your receipt.", { exact: true })).toBeVisible();
  await expect(main.getByText("Total $148.95", { exact: true })).toHaveCount(0);
  await expect(main.getByText("$148.95", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: /^Download photo \d$/ })).toHaveCount(2);
  await expect(header.getByRole("link", { name: "Bag, empty", exact: true })).toBeVisible();

  // 6. A download: the link the API answers is a JPEG attachment named by the order, never the child (call 10).
  const link = page.waitForResponse((r) =>
    /\/api\/v1\/shop\/orders\/[^/]+\/downloads\//.test(r.url()),
  );
  const downloading: Promise<Download> = page.waitForEvent("download");
  await main.getByRole("button", { name: "Download photo 1", exact: true }).click();
  const { url } = (await (await link).json()) as { url: string };
  const file = await page.request.get(url);
  expect(file.headers()["content-type"]).toBe("image/jpeg");
  expect(file.headers()["content-disposition"]).toMatch(
    /^attachment; filename="daybell-[0-9A-Z]{8}-1\.jpg"$/,
  );
  expect((await downloading).suggestedFilename()).toMatch(/^daybell-[0-9A-Z]{8}-1\.jpg$/);

  // 7. A checkout left without paying: back at the bag, cancelled, the bag unchanged.
  await main.getByRole("link", { name: "All your orders", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Your orders", level: 1, exact: true }),
  ).toBeVisible();
  await header.getByRole("link", { name: "Back", exact: true }).click();
  await docked.getByRole("link", { name: "Choose a package", exact: true }).click();
  await main.getByRole("link", { name: "Single prints and downloads", exact: true }).click();
  await main.getByRole("radio", { name: "5×7 print", exact: true }).check();
  await docked.getByRole("link", { name: "Continue", exact: true }).click();
  await docked.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();
  await docked.getByRole("button", { name: "Pay securely", exact: true }).click();
  await expect(page).toHaveURL(/\/dev\/stripe-checkout\?session=cs_test_fake/);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Back to the shop", exact: true })
    .click();
  await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();
  await expect(
    main.getByRole("status").filter({ hasText: "Payment canceled. Your bag is unchanged." }),
  ).toBeVisible();
  await expect(main.getByText("5×7 print", { exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Bag, 1 item", exact: true })).toBeVisible();

  // 8. Forget the device, enter the code again: "Your orders" shows the paid order and its downloads.
  await header.getByRole("button", { name: "More", exact: true }).click();
  await header.getByRole("button", { name: "Forget this device", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Forget this device?", exact: true })
    .getByRole("button", { name: "Forget", exact: true })
    .click();
  await expect(
    main.getByRole("heading", { name: "See your child’s photos", level: 1, exact: true }),
  ).toBeVisible();
  await enterCode(page, studio.code);
  await main.getByRole("button", { name: "See photos", exact: true }).click();
  await header.getByRole("button", { name: "More", exact: true }).click();
  await header.getByRole("link", { name: "Your orders", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Your orders", level: 1, exact: true }),
  ).toBeVisible();
  const order = main.getByRole("link", { name: /^Order [0-9A-Z]{4}-[0-9A-Z]{4}/ });
  await expect(order).toHaveCount(1);
  await expect(order).toContainText("2 downloads");
  await order.click();
  await expect(main.getByRole("button", { name: "Download photo 2", exact: true })).toBeVisible();
});
