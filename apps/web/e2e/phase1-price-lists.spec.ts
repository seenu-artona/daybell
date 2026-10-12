import { expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 6 "Products and price lists" (D36, D59, D104, D143, D96; Seenu's answers 1–8 and Claude's calls of
// Oct 12 2026; ADR 0019): the starter list every studio gets as its default (in CAD here: the local stack is the
// Canadian database, D122), editing a price, a package's contents and the home shipping fee, keyboard-only
// reordering and editing with visible focus, a copied list made the default, a new job getting it, the job's Shop
// tab switching list and school delivery, the refusals for a list in use, and that another studio can't read or
// change any of it. Desktop only (D136).
const run = `${Date.now()}`;

test("price lists: starter list, edits, a copy as default, and a job's Shop tab", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Price Studio ${tag}`,
    slug: `price-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `price-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");

  // 1. Products is built: it opens the Price lists page, with the starter list as the default.
  const menu = page.getByRole("navigation", { name: "Main" });
  await menu.getByRole("link", { name: "Products", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/products$/);
  await expect(main.getByRole("heading", { name: "Price lists", level: 1 })).toBeVisible();
  await expect(main.getByText("Prices before tax", { exact: true })).toBeVisible();
  const starterRow = main.getByRole("row").filter({ hasText: "Starter price list" });
  await expect(starterRow.getByText("Default", { exact: true })).toBeVisible();
  await expect(
    starterRow.getByText("3 packages · 5 prints · 2 digitals", { exact: true }),
  ).toBeVisible();
  // The default can't be deleted, so it has no Delete button.
  await expect(starterRow.getByRole("button")).toHaveCount(0);

  // 2. The list: 3 packages, 5 prints and 2 digital downloads, in CAD (the starter 8×10 is $27.00 CAD).
  await starterRow.getByRole("link", { name: "Starter price list", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Starter price list", level: 1 })).toBeVisible();
  const packages = main.getByRole("region", { name: "Packages", exact: true });
  const prints = main.getByRole("region", { name: "Prints", exact: true });
  const digitals = main.getByRole("region", { name: "Digital downloads", exact: true });
  await expect(packages.getByRole("listitem")).toHaveCount(3);
  await expect(prints.getByRole("listitem")).toHaveCount(5);
  await expect(digitals.getByRole("listitem")).toHaveCount(2);
  const print8x10 = prints.getByRole("listitem").filter({ hasText: "8×10 print" });
  await expect(print8x10.getByText("$27.00", { exact: true })).toBeVisible();
  // One of each digital per list: neither can be added again.
  await expect(digitals.getByRole("button", { name: /^Add / })).toHaveCount(0);

  // 3. Edit the 8×10 price to $25.00.
  await print8x10.getByRole("button", { name: "Edit 8×10 print", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Edit 8×10 print" });
  await dialog.getByLabel("Price", { exact: true }).fill("25");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(print8x10.getByText("$25.00", { exact: true })).toBeVisible();
  // Fractions of a cent are refused in the form, never rounded.
  await print8x10.getByRole("button", { name: "Edit 8×10 print", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit 8×10 print" });
  await dialog.getByLabel("Price", { exact: true }).fill("25.005");
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(
    dialog.getByText("Enter a price from $0 to $10,000, like 25 or 25.00.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  // 4. Package A: three 5×7s instead of two, and no digital download.
  const packageA = packages.getByRole("listitem").filter({ hasText: "Package A" });
  await expect(packageA).toContainText("Digital download");
  await packageA.getByRole("button", { name: "Edit Package A", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit Package A" });
  await dialog.getByLabel("How many, line 2", { exact: true }).fill("3");
  await dialog
    .getByRole("checkbox", {
      name: "Includes the digital download of the chosen pose",
      exact: true,
    })
    .uncheck();
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(packageA).toContainText("3 × 5×7");
  await expect(packageA).not.toContainText("Digital download");

  // 5. The home shipping fee, kept after a reload.
  const settings = main.getByRole("region", { name: "Settings", exact: true });
  await settings.getByLabel("Home shipping fee", { exact: true }).fill("9.50");
  await settings.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  await page.reload();
  await expect(
    main.getByRole("region", { name: "Settings", exact: true }).getByLabel("Home shipping fee", {
      exact: true,
    }),
  ).toHaveValue("9.50");

  // 6. Keyboard only: move Package C up (buttons, never drag; WCAG 2.5.7) and edit the 4×6 price. Focus stays on the
  // moved item's button and is visible.
  const moveUp = packages.getByRole("button", { name: "Move Package C up", exact: true });
  await packages.getByRole("button", { name: "Remove Package B", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(moveUp).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(packages.getByRole("listitem").nth(1)).toContainText("Package C");
  await expect(moveUp).toBeFocused();
  expect(await moveUp.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  const edit4x6 = prints.getByRole("button", { name: "Edit 4×6 print", exact: true });
  await edit4x6.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", { name: "Edit 4×6 print" });
  const price = dialog.getByLabel("Price", { exact: true });
  await price.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("12.00");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(
    prints
      .getByRole("listitem")
      .filter({ hasText: "4×6 print" })
      .getByText("$12.00", { exact: true }),
  ).toBeVisible();

  // 7. A copy of the starter list, made the default.
  await main.getByRole("link", { name: "All price lists", exact: true }).click();
  await main.getByRole("button", { name: "New price list", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "New price list" });
  await dialog.getByLabel("Name", { exact: true }).fill(`Spring ${tag}`);
  await dialog.getByLabel("Start from", { exact: true }).selectOption({
    label: "A copy of Starter price list",
  });
  await dialog.getByRole("button", { name: "Create price list", exact: true }).click();
  await expect(main.getByRole("heading", { name: `Spring ${tag}`, level: 1 })).toBeVisible();
  await expect(
    main
      .getByRole("region", { name: "Prints", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "8×10 print" })
      .getByText("$25.00", { exact: true }),
  ).toBeVisible();
  await main.getByRole("link", { name: "All price lists", exact: true }).click();
  const springRow = main.getByRole("row").filter({ hasText: `Spring ${tag}` });
  await springRow
    .getByRole("button", { name: `Make Spring ${tag} the default`, exact: true })
    .click();
  await expect(springRow.getByText("Default", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("status").filter({ hasText: `Spring ${tag} is now the default for new jobs.` }),
  ).toBeVisible();

  // 8. A new job gets the new default; its Shop tab switches list and turns on school delivery, kept after a reload.
  const lists = (await (await page.request.get("/api/v1/price-lists")).json()).priceLists as {
    id: string;
    name: string;
    isDefault: boolean;
  }[];
  const spring = lists.find((l) => l.name === `Spring ${tag}`);
  const starter = lists.find((l) => l.name === "Starter price list");
  expect(spring?.isDefault).toBe(true);
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Shop Job ${tag}`, type: "school", pictureDay: "2030-05-01" },
  });
  expect(created.status()).toBe(201);
  const job = (await created.json()).job as {
    id: string;
    priceListId: string;
    deliverToSchool: boolean;
  };
  expect(job.priceListId).toBe(spring?.id);
  expect(job.deliverToSchool).toBe(false);
  await page.goto(`/app/jobs/${job.id}/shop`);
  const listCard = main.getByRole("region", { name: "Price list", exact: true });
  const choose = listCard.getByLabel("Price list for this job", { exact: true });
  await expect(choose).toHaveValue(spring?.id ?? "");
  await choose.selectOption(starter?.id ?? "");
  await expect(main.getByRole("status").filter({ hasText: "Price list saved." })).toBeVisible();
  await expect(
    listCard.getByRole("listitem").filter({ hasText: "4×6 print" }).getByText("$12.00", {
      exact: true,
    }),
  ).toBeVisible();
  const delivery = main.getByRole("region", { name: "Delivery", exact: true });
  await expect(delivery.getByText("$9.50 per order", { exact: false })).toBeVisible();
  const toSchool = delivery.getByRole("checkbox", { name: "Free delivery to school", exact: true });
  await expect(toSchool).not.toBeChecked();
  await toSchool.check();
  await expect(
    main.getByRole("status").filter({ hasText: "Free delivery to school is on." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    main
      .getByRole("region", { name: "Price list", exact: true })
      .getByLabel("Price list for this job", { exact: true }),
  ).toHaveValue(starter?.id ?? "");
  await expect(
    main
      .getByRole("region", { name: "Delivery", exact: true })
      .getByRole("checkbox", { name: "Free delivery to school", exact: true }),
  ).toBeChecked();

  // 9. A list a job uses can't be deleted; the reason is said in words.
  await page.goto("/app/products");
  const usedRow = main.getByRole("row").filter({ hasText: "Starter price list" });
  await expect(usedRow.getByText("1 job", { exact: true })).toBeVisible();
  await usedRow.getByRole("button", { name: "Delete Starter price list", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Delete this price list?" });
  await dialog.getByRole("button", { name: "Delete price list", exact: true }).click();
  await expect(
    dialog.getByText("Jobs use this price list. Give them another list on their Shop tab first.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  // Saving price list changes ticked "Review your price list" on Home's setup checklist.
  const checklist = await (await page.request.get("/api/v1/studio/checklist")).json();
  expect(
    checklist.onboarding?.tasks.find((t: { key: string }) => t.key === "priceList")?.done ?? true,
  ).toBe(true);

  // 10. Another studio can't read or change any of it, nor give its own job the first studio's list.
  const outsider = await signUpOwner(await (await browser.newContext()).newPage(), {
    studio: `Other Price ${tag}`,
    slug: `oprice-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `price-outsider-${tag}@example.test`,
  });
  const theirLists = (await (await outsider.request.get("/api/v1/price-lists")).json()).priceLists;
  expect(theirLists.map((l: { name: string }) => l.name)).toEqual(["Starter price list"]);
  expect(JSON.stringify(theirLists)).not.toContain(spring?.id ?? "x");
  expect((await outsider.request.get(`/api/v1/price-lists/${spring?.id}`)).status()).toBe(404);
  expect(
    (
      await outsider.request.patch(`/api/v1/price-lists/${spring?.id}`, {
        data: { homeShippingCents: 1 },
      })
    ).status(),
  ).toBe(404);
  expect((await outsider.request.delete(`/api/v1/price-lists/${spring?.id}`)).status()).toBe(404);
  expect((await outsider.request.post(`/api/v1/price-lists/${spring?.id}/default`)).status()).toBe(
    404,
  );
  const springItems = (await (await page.request.get(`/api/v1/price-lists/${spring?.id}`)).json())
    .priceList.items as { id: string }[];
  expect(
    (
      await outsider.request.patch(`/api/v1/price-list-items/${springItems[0]?.id}`, {
        data: { priceCents: 1 },
      })
    ).status(),
  ).toBe(404);
  const sneaky = await outsider.request.post("/api/v1/jobs", {
    data: { name: "Sneaky", type: "school", pictureDay: "2030-05-01", priceListId: spring?.id },
  });
  expect(sneaky.status()).toBe(400);
  expect((await sneaky.json()).error.fields).toEqual({ priceListId: "validation.priceList" });
  // Nothing changed for the first studio.
  const after = (await (await page.request.get(`/api/v1/price-lists/${spring?.id}`)).json())
    .priceList;
  expect(after.homeShipping).toEqual({ cents: 950, currency: "CAD" });
});
