import { expect, test } from "@playwright/test";
import { joinAs, signUpOwner } from "./helpers";

// UI round 7 "Job › Shop" (D157; Seenu's answers B1, B2, B3e, N4 of Oct 14, 2026; ADR 0033), desktop only (D136), on
// the Canadian local stack (CAD). An owner changes a price for this job only (Enter saves, the list's price typed back
// undoes it, leaving the field saves, Escape restores), switches an item off with the keyboard, adds a print only this
// job sells and edits it, sees Change warn how many changes a swap removes, swaps the list (the job's own product
// stays) and turns on school delivery. The shared list never changes. A photographer reads the same page with nothing
// to change and sees Settings › Shop; another studio gets 404 for all of it. Locators are scoped and exact.
const run = `${Date.now()}`;
/** A whole-text match: the status line says exactly this, not something that merely contains it. */
const whole = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

test("Job › Shop: this job's prices and Sold, a product of its own, Change's warning, read-only and other studios", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Job Shop ${tag}`,
    slug: `jshop-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `jshop-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");
  const status = (text: string) => main.getByRole("status").filter({ hasText: whole(text) });

  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Shop Job ${tag}`, type: "school", pictureDay: "2030-05-01" },
  });
  expect(created.status()).toBe(201);
  const job = (await created.json()).job as { id: string; priceListId: string };
  const spring = await page.request.post("/api/v1/price-lists", {
    data: { name: `Spring ${tag}`, copyFromId: job.priceListId },
  });
  expect(spring.status()).toBe(201);
  const springId = (await spring.json()).priceList.id as string;

  // 1. The job's list, one table, no changes yet.
  await page.goto(`/app/jobs/${job.id}/shop`);
  const list = main.getByRole("region", { name: "Starter price list", exact: true });
  const table = list.getByRole("table", { name: "What parents can buy", exact: true });
  await expect(list.getByText("No changes for this job", { exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText([
    "Product",
    "Price list",
    "This job",
    "Sold",
  ]);

  // 2. A price for this job: Enter saves; focus stays; the shared list never changes (D157).
  const packageA = table.getByLabel("Price for this job: Package A", { exact: true });
  await expect(packageA).toHaveValue("85.00");
  await packageA.fill("90");
  await packageA.press("Enter");
  await expect(status("Saved. 1 change for this job")).toBeVisible();
  await expect(packageA).toHaveValue("90.00");
  await expect(packageA).toBeFocused();
  await expect(list.getByText("1 change for this job", { exact: true })).toBeVisible();
  const starter = (await (await page.request.get(`/api/v1/price-lists/${job.priceListId}`)).json())
    .priceList as { items: { name: string; price: { cents: number } }[] };
  expect(starter.items.find((i) => i.name === "Package A")?.price.cents).toBe(8500);

  // 3. The list's price typed back undoes it, and leaving the field saves too (N4). Escape puts the saved price back.
  await packageA.fill("85");
  await packageA.press("Tab");
  await expect(status("Saved. No changes for this job")).toBeVisible();
  await packageA.fill("1");
  await packageA.press("Escape");
  await expect(packageA).toHaveValue("85.00");

  // 4. Switched off with the keyboard: Space, focus stays, it says Off (never colour alone).
  const wallets = table.getByRole("switch", { name: "Sold: Wallets (sheet of 8)", exact: true });
  await expect(wallets).toHaveAttribute("aria-checked", "true");
  await wallets.focus();
  await page.keyboard.press("Space");
  await expect(status("Saved. 1 change for this job")).toBeVisible();
  await expect(wallets).toHaveAttribute("aria-checked", "false");
  await expect(wallets).toHaveText("Off");
  await expect(wallets).toBeFocused();

  // 5. A print only this job sells (B2): the Price list column says — ("Not on the price list").
  await list.getByRole("button", { name: "Add a product", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add a product for this job", exact: true });
  await add.getByRole("radio", { name: "Print", exact: true }).check();
  await add.getByRole("button", { name: "Next", exact: true }).click();
  await add.getByRole("textbox", { name: "Name", exact: true }).fill("Panorama");
  await add.getByLabel("Price", { exact: true }).fill("45");
  await add.getByLabel("Print size", { exact: true }).selectOption("11x14");
  await add.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(status("Panorama added. 2 changes for this job")).toBeVisible();
  const panorama = table.getByRole("row").filter({ hasText: "Panorama" });
  await expect(panorama.getByText("Not on the price list", { exact: true })).toBeAttached();
  await expect(panorama.getByLabel("Price for this job: Panorama", { exact: true })).toHaveValue(
    "45.00",
  );

  // 6. Its name opens the same dialog again.
  await panorama.getByRole("button", { name: "Edit Panorama", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit Panorama", exact: true });
  await edit.getByLabel("Price", { exact: true }).fill("50");
  await edit.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(status("Panorama saved. 2 changes for this job")).toBeVisible();
  await expect(panorama.getByLabel("Price for this job: Panorama", { exact: true })).toHaveValue(
    "50.00",
  );

  // 7. Change warns how many of the job's changes another list removes (B1); Cancel keeps everything.
  await packageA.fill("90");
  await packageA.press("Enter");
  await expect(status("Saved. 3 changes for this job")).toBeVisible();
  await list.getByRole("button", { name: "Change price list", exact: true }).click();
  const change = page.getByRole("dialog", { name: "Change price list", exact: true });
  const choose = change.getByLabel("Price list for this job", { exact: true });
  await expect(choose).toHaveValue(job.priceListId);
  await choose.selectOption(springId);
  await expect(
    change.getByText("2 changes for this job will be removed.", { exact: true }),
  ).toBeVisible();
  await expect(
    change.getByText("Products only this job sells stay.", { exact: true }),
  ).toBeVisible();
  await change.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(list.getByText("3 changes for this job", { exact: true })).toBeVisible();

  // 8. Swapped: the old list's changes go, the job's own print stays.
  await list.getByRole("button", { name: "Change price list", exact: true }).click();
  await change.getByLabel("Price list for this job", { exact: true }).selectOption(springId);
  await change.getByRole("button", { name: "Change price list", exact: true }).click();
  await expect(status(`Price list changed to Spring ${tag}.`)).toBeVisible();
  const springList = main.getByRole("region", { name: `Spring ${tag}`, exact: true });
  await expect(springList.getByText("1 change for this job", { exact: true })).toBeVisible();
  await expect(springList.getByLabel("Price for this job: Package A", { exact: true })).toHaveValue(
    "85.00",
  );
  await expect(
    springList.getByRole("switch", { name: "Sold: Wallets (sheet of 8)", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(springList.getByRole("row").filter({ hasText: "Panorama" })).toHaveCount(1);

  // 9. Delivery: free delivery to school is a switch (N9), kept after a reload.
  const delivery = main.getByRole("region", { name: "Delivery", exact: true });
  const toSchool = delivery.getByRole("switch", { name: "Free delivery to school", exact: true });
  await expect(toSchool).toHaveAttribute("aria-checked", "false");
  await toSchool.click();
  await expect(status("Free delivery to school is on.")).toBeVisible();
  await expect(toSchool).toHaveAttribute("aria-checked", "true");
  const more = main.getByRole("region", { name: "More for this job", exact: true });
  await expect(more.getByText("Soon", { exact: true })).toHaveCount(4);
  await page.reload();
  await expect(
    main
      .getByRole("region", { name: "Delivery", exact: true })
      .getByRole("switch", { name: "Free delivery to school", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    main
      .getByRole("region", { name: `Spring ${tag}`, exact: true })
      .getByText("1 change for this job", { exact: true }),
  ).toBeVisible();

  // 10. A photographer reads the same page with its prices (N10) and nothing to change, and sees Settings › Shop.
  const photographer = await joinAs(
    page,
    browser,
    `jshop-photographer-${tag}@example.test`,
    "photographer",
  );
  const theirMain = photographer.getByRole("main");
  await photographer.goto(`/app/jobs/${job.id}/shop`);
  const theirList = theirMain.getByRole("region", { name: `Spring ${tag}`, exact: true });
  await expect(
    theirList.getByRole("table", { name: "What parents can buy", exact: true }),
  ).toBeVisible();
  await expect(
    theirMain.getByText("Only owners and admins can change this job's shop.", { exact: true }),
  ).toBeVisible();
  await expect(theirList.getByRole("textbox")).toHaveCount(0);
  await expect(theirMain.getByRole("switch")).toHaveCount(0);
  const spring5x7 = (
    (await (await photographer.request.get(`/api/v1/jobs/${job.id}/shop`)).json()).shop as {
      rows: { itemId: string; name: string }[];
    }
  ).rows.find((r) => r.name === "5×7 print")?.itemId as string;
  expect(
    (
      await photographer.request.patch(`/api/v1/jobs/${job.id}/shop/prices/${spring5x7}`, {
        data: { priceCents: 100 },
      })
    ).status(),
  ).toBe(403);
  await photographer.goto("/app/settings/shop");
  await expect(
    theirMain
      .getByRole("navigation", { name: "Settings sections", exact: true })
      .getByRole("link", { name: "Shop", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(theirMain.getByRole("heading", { name: "Shop address", exact: true })).toBeVisible();
  await expect(theirMain.locator("code")).toHaveText(/\/shop$/);
  await photographer.context().close();

  // 11. Another studio finds none of it.
  const otherContext = await browser.newContext();
  const other = await signUpOwner(await otherContext.newPage(), {
    studio: `Other Shop ${tag}`,
    slug: `jshop2-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `jshop-other-${tag}@example.test`,
  });
  expect((await other.request.get(`/api/v1/jobs/${job.id}/shop`)).status()).toBe(404);
  expect(
    (
      await other.request.patch(`/api/v1/jobs/${job.id}/shop/prices/${spring5x7}`, {
        data: { priceCents: 100 },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await other.request.post(`/api/v1/jobs/${job.id}/shop/items`, {
        data: { kind: "print", name: "Sneaky", priceCents: 100, printSize: "4x6" },
      })
    ).status(),
  ).toBe(404);
  await otherContext.close();
});
