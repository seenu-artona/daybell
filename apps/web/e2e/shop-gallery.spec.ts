import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, devices, expect, type Page, test } from "@playwright/test";
import { cardCodes, photo, signUpOwner } from "./helpers";

// Phase 1 step 9 "Parent gallery" (D24, D60, D116, D119, F17; Seenu's answers 1–4, Claude's calls 1–13; ADR 0022), on a
// phone (Pixel 7), with STORAGE_DRIVER=local and STRIPE_DRIVER=fake. A studio (set up in a desktop-sized context: the
// studio app is desktop only, D136) sells a job with two children; a parent types the first code, sees the cover and
// "See photos", the grid, blur while the page is hidden, the viewer with Previous and Next, "Use this photo", a package
// and its pose; adds the brother's code and switches between them; buys a print and a single download; chooses
// delivery and sees the totals; forgets the device. A draft job's code says the shop is closed, without the child's
// name. Five wrong codes lock a phone out. Reduced motion: the cover's words don't slide. Locators are scoped to a
// landmark and exact (code review S4).
test.use({ reducedMotion: "reduce" });

const run = `${Date.now()}`;
const pastDay = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** A studio with a selling job (Ava and her brother Noah, tagged by their cards) and a draft job (Mia). */
async function studioSellingTwoChildren(browser: Browser, baseURL: string, tag: string) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const page = await signUpOwner(await context.newPage(), {
    studio: `Maple Lane ${tag}`,
    slug: `shop-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `shop-owner-${tag}@example.test`,
  });
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Fall Portraits ${tag}`, type: "school", pictureDay: pastDay() },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  const codes: Record<string, string> = {};
  for (const firstName of ["Ava", "Noah"]) {
    const added = await page.request.post(`/api/v1/jobs/${jobId}/children`, {
      data: { firstName, lastName: "Patel" },
    });
    expect(added.status()).toBe(201);
    const child = (await added.json()).child as { id: string; accessCode: string };
    codes[child.id] = child.accessCode;
  }
  expect((await page.request.post(`/api/v1/jobs/${jobId}/qr-cards`, { data: {} })).status()).toBe(
    200,
  );
  const cards = await cardCodes(page, jobId);
  const [ava, noah] = Object.keys(codes).map(
    (id) => cards.find((c) => c.child_id === id)?.card_code ?? "",
  );
  const folder = mkdtempSync(join(tmpdir(), "daybell-shop-"));
  const day = join(folder, "Picture day");
  mkdirSync(day);
  writeFileSync(join(day, "IMG_0001.JPG"), await photo(11, { payload: `DBC1:${ava}` }));
  writeFileSync(join(day, "IMG_0002.JPG"), await photo(12));
  writeFileSync(join(day, "IMG_0003.JPG"), await photo(13));
  writeFileSync(join(day, "IMG_0004.JPG"), await photo(14, { payload: `DBC1:${noah}` }));
  writeFileSync(join(day, "IMG_0005.JPG"), await photo(15));
  const main = page.getByRole("main");
  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = main.getByRole("region", { name: "Upload photos", exact: true });
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(day);
  await expect(sheet.getByText("Done: 5 photos added", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await page.goto(`/app/jobs/${jobId}/photos/review`);
  await expect(
    main.getByText("5 photos · 0 in Leftovers · 0 to check", { exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  expect((await page.request.post(`/api/v1/jobs/${jobId}/tagging/review`)).status()).toBe(200);
  expect(
    (
      await page.request.patch(`/api/v1/jobs/${jobId}`, {
        data: { deliverToSchool: true, closesAt: inDays(10) },
      })
    ).status(),
  ).toBe(200);
  expect((await page.request.post("/api/v1/studio/payouts/onboarding-link")).status()).toBe(200);
  expect(
    (await page.request.post("/api/dev-stripe", { data: { action: "finish" } })).status(),
  ).toBe(200);
  expect((await page.request.post(`/api/v1/jobs/${jobId}/start-selling`)).status()).toBe(200);

  const draft = await page.request.post("/api/v1/jobs", {
    data: { name: `Spring ${tag}`, type: "school", pictureDay: pastDay() },
  });
  const draftId = (await draft.json()).job.id as string;
  const mia = await page.request.post(`/api/v1/jobs/${draftId}/children`, {
    data: { firstName: "Mia", lastName: "Chen" },
  });
  const [avaCode, noahCode] = Object.values(codes);
  await context.close();
  return {
    studio: `Maple Lane ${tag}`,
    ava: avaCode as string,
    noah: noahCode as string,
    mia: (await mia.json()).child.accessCode as string,
  };
}

async function enterCode(page: Page, code: string, button: string) {
  const main = page.getByRole("main");
  await main.getByLabel("Access code", { exact: true }).fill(code);
  await main.getByRole("button", { name: button, exact: true }).click();
}

test("parent gallery: code, cover, grid, viewer, package and pose, a sibling, a print and a download, delivery, forget, closed and locked", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000);
  const tag = `${info.project.name}-${run}`;
  const baseURL = info.project.use.baseURL as string;
  const studio = await studioSellingTwoChildren(browser, baseURL, tag);
  const main = page.getByRole("main");
  const header = page.getByRole("banner");
  // The one main action of each screen, docked at the bottom (code review S4).
  const docked = page.getByRole("region", { name: "Next step", exact: true });

  // 1. The one shop address; neutral until a code is entered (answer 1). The code opens the cover (D24, D119).
  await page.goto("/shop");
  await expect(
    main.getByRole("heading", { name: "See your child’s photos", level: 1, exact: true }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Lost your code?", exact: true }).click();
  await expect(
    main.getByText("Ask your photographer or school for a new card.", { exact: true }),
  ).toBeVisible();
  await enterCode(page, studio.ava.toLowerCase().replace("-", " "), "View photos");
  await expect(main.getByRole("heading", { name: "Ava P.", level: 1, exact: true })).toBeVisible();
  await expect(main.getByText(studio.studio, { exact: true })).toBeVisible();
  // Reduced motion: the words are in place at once, with no transition (D119).
  await expect(main.locator("[data-cover-text]")).toHaveCSS("transition-property", "none");
  await expect(main.locator("[data-cover-text]")).toHaveCSS("opacity", "1");
  await main.getByRole("button", { name: "See photos", exact: true }).click();

  // 2. The grid: the child's portraits only, the order-by date, delivery to school, the protection line.
  await expect(
    header.getByRole("heading", { name: "Ava P.", level: 1, exact: true }),
  ).toBeVisible();
  await expect(main.getByText(/^Order by \S+ \d+$/)).toBeVisible();
  await expect(main.getByText(/Free delivery to school$/)).toBeVisible();
  await expect(
    main.getByText("Photos are protected and shown at low resolution with a watermark.", {
      exact: true,
    }),
  ).toBeVisible();
  const grid = main.getByRole("list", { name: "Photos of Ava P.", exact: true });
  await expect(grid.getByRole("button")).toHaveCount(2);
  const images = await grid
    .locator("img")
    .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).getAttribute("src") ?? ""));
  for (const src of images) expect(src).toMatch(/\/proof-thumb\.webp\?/);

  // 3. Deterrents (D60): blurred while the page is hidden, clear again after.
  const hide = (state: "hidden" | "visible") =>
    page.evaluate((s) => {
      Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  await hide("hidden");
  await expect(page.locator('[data-shop-protection="blurred"]')).toHaveCount(1);
  await hide("visible");
  await expect(page.locator('[data-shop-protection="clear"]')).toHaveCount(1);

  // 4. The viewer: Previous and Next (not just swiping, WCAG 2.5.7), then "Use this photo".
  await grid.getByRole("button", { name: "Ava, photo 1 of 2", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Photo 1 of 2", exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Next photo", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Photo 2 of 2", exact: true })).toBeVisible();
  await page
    .getByRole("dialog", { name: "Photo 2 of 2", exact: true })
    .getByRole("button", { name: "Previous photo", exact: true })
    .click();
  await viewer.getByRole("link", { name: "Use this photo", exact: true }).click();

  // 5. Package, then pose (D24).
  await expect(
    header.getByRole("heading", { name: "Choose a package", level: 1, exact: true }),
  ).toBeVisible();
  await main.getByRole("radio", { name: "Package B", exact: true }).check();
  await docked.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Package B", level: 1, exact: true }),
  ).toBeVisible();
  const poses = main.getByRole("group", { name: "Pose", exact: true });
  await expect(poses.getByRole("radio", { name: "Pose 1 of 2", exact: true })).toBeChecked();
  await docked.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Bag, 1 item", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Bag");

  // 6. A brother's code (call 1), then switching between the children.
  await header.getByRole("link", { name: "Back", exact: true }).click();
  await main.getByRole("link", { name: "Add a brother or sister", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Add a brother or sister", level: 1, exact: true }),
  ).toBeVisible();
  await enterCode(page, studio.noah, "Add");
  await expect(main.getByRole("heading", { name: "Noah P.", level: 1, exact: true })).toBeVisible();
  await main.getByRole("button", { name: "See photos", exact: true }).click();
  const children = main.getByRole("navigation", { name: "Children", exact: true });
  await expect(children.getByRole("link", { name: "Noah P.", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await children.getByRole("link", { name: "Ava P.", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Ava P.", level: 1, exact: true }),
  ).toBeVisible();
  await children.getByRole("link", { name: "Noah P.", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Noah P.", level: 1, exact: true }),
  ).toBeVisible();

  // 7. A print and a single download for Noah.
  for (const item of ["5×7 print", "Digital download"]) {
    await docked.getByRole("link", { name: "Choose a package", exact: true }).click();
    await main.getByRole("link", { name: "Single prints and downloads", exact: true }).click();
    await main.getByRole("radio", { name: item, exact: true }).check();
    await docked.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(header.getByRole("heading", { name: item, level: 1, exact: true })).toBeVisible();
    await docked.getByRole("button", { name: "Add to bag", exact: true }).click();
    await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();
    await header.getByRole("link", { name: "Back", exact: true }).click();
    await children.getByRole("link", { name: "Noah P.", exact: true }).click();
  }

  // 8. The bag: by child, delivery to school or home (call 9), the total before tax.
  await header.getByRole("link", { name: "Bag, 3 items", exact: true }).click();
  const ava = main.getByRole("region", { name: "For Ava P.", exact: true });
  const noah = main.getByRole("region", { name: "For Noah P.", exact: true });
  await expect(ava.getByText("Package B", { exact: true })).toBeVisible();
  await expect(noah.getByText("5×7 print", { exact: true })).toBeVisible();
  await expect(noah.getByText("Digital download", { exact: true })).toBeVisible();
  const delivery = main.getByRole("group", { name: "Delivery", exact: true });
  await expect(main.getByText("Choose delivery", { exact: true })).toBeVisible();
  await delivery.getByRole("radio", { name: "Delivery to school", exact: true }).check();
  await expect(main.getByText("Total $111.00", { exact: true })).toBeVisible();
  await expect(main.getByText("+ tax", { exact: true })).toBeVisible();
  await delivery.getByRole("radio", { name: "Home delivery", exact: true }).check();
  await expect(main.getByText("Total $122.95", { exact: true })).toBeVisible();
  await noah
    .getByRole("group", { name: "How many: 5×7 print", exact: true })
    .getByRole("button", { name: "One more", exact: true })
    .click();
  await expect(main.getByText("Total $141.95", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /pay/i })).toHaveCount(0);

  // 9. Forget this device (answer 3): back to the code page; the bag is gone with it.
  await header.getByRole("button", { name: "More", exact: true }).click();
  await header.getByRole("button", { name: "Forget this device", exact: true }).click();
  const forget = page.getByRole("dialog", { name: "Forget this device?", exact: true });
  await forget.getByRole("button", { name: "Forget", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "See your child’s photos", level: 1, exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/shop/cart")).status()).toBe(401);

  // 10. A draft job's code: the shop is closed, naming the studio, with no photos (answer 4).
  await enterCode(page, studio.mia, "View photos");
  await expect(
    main.getByText(`This shop is closed. Contact ${studio.studio}.`, { exact: true }),
  ).toBeVisible();
  await expect(main.locator("img")).toHaveCount(0);
  // Never the child's name for a closed or draft shop (security review M1).
  await expect(
    header.getByRole("heading", { name: "Your child", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Mia");

  // 11. Five wrong codes lock a phone out for 15 minutes (answer 2), on another phone.
  const other = await browser.newContext({ ...devices["Pixel 7"], baseURL });
  const phone = await other.newPage();
  await phone.goto("/shop");
  const alert = phone.getByRole("main").getByRole("alert");
  for (let i = 1; i <= 4; i++) {
    await enterCode(phone, `ZZZZ-ZZZ${i + 1}`, "View photos");
    await expect(alert).toHaveText("We couldn’t find that code. Check it and try again.");
  }
  await enterCode(phone, "ZZZZ-ZZZ7", "View photos");
  await expect(alert).toHaveText("Too many tries. Wait 15 minutes and try again.");
  await enterCode(phone, studio.ava, "View photos");
  await expect(alert).toHaveText("Too many tries. Wait 15 minutes and try again.");
  await other.close();
});
