import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { photo, studioSellingAva } from "./helpers";

// UI round 7: selling group photos and each job's own prices in the parent shop (D156 C5, D157; ADR 0033), on a phone
// (Pixel 7) with STORAGE_DRIVER=local and STRIPE_DRIVER=fake. The studio (set up in a desktop-sized context, D136) puts
// Ava in a group "Choir", uploads one group photo into it, prices the 5×7 print at $21 for this job, switches the
// wallets off and adds a Panorama print only this job sells. The parent opens Ava's group photos, uses the group photo
// for Package B (the pose page has it chosen, under "Group photos"), buys the Panorama with it, never sees the wallets,
// and the bag totals the job's prices. Locators are scoped to a landmark or a dialog, and exact.
test.use({ reducedMotion: "reduce" });

const run = `${Date.now()}`;

// The parent polls the gallery while the group photo is processed: its own network, so it doesn't share the shop's
// 120-a-minute budget with the specs before it (as shop-orders.spec.ts).
test.beforeEach(async ({ page }, info) => {
  const octet =
    (Number(run.slice(-3)) + 53 + info.retry * 7 + (info.project.name === "phone" ? 101 : 0)) % 250;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${octet + 1}` });
});

async function enterCode(page: Page, code: string) {
  const main = page.getByRole("main");
  await main.getByLabel("Access code", { exact: true }).fill(code);
  await main.getByRole("button", { name: "View photos", exact: true }).click();
}

test("parent shop: a group photo as a package's pose and a job's own print, at the job's prices", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000);
  const tag = `${info.project.name}-${run}`;
  const baseURL = info.project.use.baseURL as string;
  const studio = await studioSellingAva(browser, baseURL, tag);

  // 1. The studio: Choir with Ava, one group photo uploaded into it, and the job's own prices (D157).
  const owner = studio.page;
  const ownerMain = owner.getByRole("main");
  const children = (
    (await (await owner.request.get(`/api/v1/jobs/${studio.jobId}/children`)).json()).children as {
      id: string;
      firstName: string;
    }[]
  ).filter((c) => c.firstName === "Ava");
  const avaId = children[0]?.id as string;
  const made = await owner.request.post(`/api/v1/jobs/${studio.jobId}/groups`, {
    data: { name: "Choir" },
  });
  expect(made.status()).toBe(201);
  const choirId = (await made.json()).group.id as string;
  expect(
    (
      await owner.request.post(`/api/v1/groups/${choirId}/members`, { data: { add: [avaId] } })
    ).status(),
  ).toBe(200);
  const groupDay = join(mkdtempSync(join(tmpdir(), "daybell-group-sale-")), "Group photos");
  mkdirSync(groupDay);
  writeFileSync(join(groupDay, "GRP_0001.JPG"), await photo(61));
  await owner.goto(`/app/jobs/${studio.jobId}/photos`);
  await ownerMain.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = ownerMain.getByRole("region", { name: "Upload photos", exact: true });
  await sheet.getByRole("radio", { name: "Group photos", exact: true }).check();
  await sheet
    .getByRole("combobox", { name: "Group", exact: true })
    .selectOption({ label: "Choir" });
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(groupDay);
  await expect(sheet.getByText("Done: 1 photo added", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const shop = (await (await owner.request.get(`/api/v1/jobs/${studio.jobId}/shop`)).json())
    .shop as { rows: { itemId: string; name: string }[] };
  const row = (name: string) => shop.rows.find((r) => r.name === name)?.itemId as string;
  const prices = `/api/v1/jobs/${studio.jobId}/shop/prices`;
  expect(
    (
      await owner.request.patch(`${prices}/${row("5×7 print")}`, { data: { priceCents: 2100 } })
    ).status(),
  ).toBe(200);
  expect(
    (
      await owner.request.patch(`${prices}/${row("Wallets (sheet of 8)")}`, {
        data: { sold: false },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await owner.request.post(`/api/v1/jobs/${studio.jobId}/shop/items`, {
        data: { kind: "print", name: "Panorama", priceCents: 4500, printSize: "11x14" },
      })
    ).status(),
  ).toBe(201);
  await studio.context.close();

  const main = page.getByRole("main");
  const header = page.getByRole("banner");
  const docked = page.getByRole("region", { name: "Next step", exact: true });

  // 2. The parent's code; the group photo shows once it is processed and tagged.
  await page.goto("/shop");
  await enterCode(page, studio.code);
  await expect(main.getByRole("heading", { name: "Ava P.", level: 1, exact: true })).toBeVisible();
  await main.getByRole("button", { name: "See photos", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Ava P.", level: 1, exact: true }),
  ).toBeVisible();
  const bagHref = (await header
    .getByRole("link", { name: "Bag, empty", exact: true })
    .getAttribute("href")) as string;
  const q = `gallery=${new URL(bagHref, baseURL).searchParams.get("gallery")}`;
  const childId = /\/shop\/c\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/v1/shop/children/${childId}/gallery?${q}`)).json())
            .groupPhotos as unknown[]
        ).length,
      { timeout: 150_000, intervals: [3_000] },
    )
    .toBe(1);
  await page.reload();

  // 3. Group photos, the viewer, and "Use this photo" (D156 C5).
  await main
    .getByRole("group", { name: "Photo sets", exact: true })
    .getByRole("button", { name: "Group photos", exact: true })
    .click();
  const grid = main.getByRole("list", { name: "Ava P.’s group photos", exact: true });
  await grid.getByRole("button", { name: "Ava’s group photo 1 of 1", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Photo 1 of 1", exact: true });
  await viewer.getByRole("link", { name: "Use this photo", exact: true }).click();

  // 4. Package B with the group photo: chosen already, in its own labelled set after the portraits (N6).
  await expect(
    header.getByRole("heading", { name: "Choose a package", level: 1, exact: true }),
  ).toBeVisible();
  await main.getByRole("radio", { name: "Package B", exact: true }).check();
  await docked.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Package B", level: 1, exact: true }),
  ).toBeVisible();
  const poses = main.getByRole("group", { name: "Pose", exact: true });
  await expect(
    poses
      .getByRole("group", { name: "Group photos", exact: true })
      .getByRole("radio", { name: "Group photo 1 of 1", exact: true }),
  ).toBeChecked();
  await expect(
    poses
      .getByRole("group", { name: "Portraits", exact: true })
      .getByRole("radio", { name: "Pose 1 of 2", exact: true }),
  ).not.toBeChecked();
  await docked.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Bag, 1 item", exact: true })).toBeVisible();

  // 5. Singles: the job's own print and price; the wallets are switched off, so never offered.
  await header.getByRole("link", { name: "Back", exact: true }).click();
  await docked.getByRole("link", { name: "Choose a package", exact: true }).click();
  await main.getByRole("link", { name: "Single prints and downloads", exact: true }).click();
  await expect(main.getByRole("radio", { name: "Wallets (sheet of 8)", exact: true })).toHaveCount(
    0,
  );
  await expect(main.locator("label").filter({ hasText: "5×7 print" })).toContainText("$21.00");
  await main.getByRole("radio", { name: "Panorama", exact: true }).check();
  await docked.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "Panorama", level: 1, exact: true }),
  ).toBeVisible();
  await main.getByRole("radio", { name: "Group photo 1 of 1", exact: true }).check();
  await docked.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(header.getByRole("heading", { name: "Bag", level: 1, exact: true })).toBeVisible();

  // 6. The bag, at the job's prices: Package B $59.00 and the Panorama $45.00, delivered to school.
  await expect(header.getByRole("link", { name: "Bag, 2 items", exact: true })).toBeVisible();
  const ava = main.getByRole("region", { name: "For Ava P.", exact: true });
  await expect(ava.getByText("Package B", { exact: true })).toBeVisible();
  await expect(ava.getByText("Panorama", { exact: true })).toBeVisible();
  await main
    .getByRole("group", { name: "Delivery", exact: true })
    .getByRole("radio", { name: "Delivery to school", exact: true })
    .check();
  await expect(main.getByText("Total $104.00", { exact: true })).toBeVisible();
});
