import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cardCodes, joinAs, photo, signUpOwner } from "./helpers";

// Phase 1 step 8 "Going live" (D75, D127, D143, D96; Claude's calls 1–8; ADR 0021), with STORAGE_DRIVER=local and
// STRIPE_DRIVER=fake: a job gets ready (a child, a card photo and a photo, tagging reviewed, payouts Active on the fake
// Stripe); every "Before you can sell" item reads Done; Start selling makes it Selling, says so, moves focus to the job's
// name and bursts no confetti with reduced motion; the checklist's Start selling ticks; Home lists it under Jobs selling
// now; an admin hears about it on the bell and a row opens the job; Mark all as read empties the owner's bell; staff
// see no Close shop and the API refuses them; a closing date shows; Close shop and Reopen shop work; a job that isn't
// ready is refused by the server, naming what is missing; another studio can do nothing. Desktop only (D136).
// Scheduled closing isn't run here (no CRON_SECRET in CI): pgTAP 018 and the route tests cover it.
test.use({ reducedMotion: "reduce" });

const run = `${Date.now()}`;
const pastDay = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole-text match. */
const whole = (text: string) => new RegExp(`^${literal(text)}$`);

test("going live: ready, start selling, the bell, closing date, close and reopen, refusals and separation", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Live Studio ${tag}`,
    slug: `live-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `live-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");
  const menu = page.getByRole("complementary", { name: "Studio menu", exact: true });
  const jobName = `Going Live ${tag}`;

  // 1. A job reaches Ready: one child with a card, an upload of their card and one photo, tagging reviewed.
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: jobName, type: "school", pictureDay: pastDay() },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  const added = await page.request.post(`/api/v1/jobs/${jobId}/children`, {
    data: { firstName: "Maya", lastName: "Johnson" },
  });
  expect(added.status()).toBe(201);
  const childId = (await added.json()).child.id as string;
  expect((await page.request.post(`/api/v1/jobs/${jobId}/qr-cards`, { data: {} })).status()).toBe(
    200,
  );
  const [card] = await cardCodes(page, jobId);
  const folder = mkdtempSync(join(tmpdir(), "daybell-live-"));
  const day = join(folder, "Picture day");
  mkdirSync(day);
  writeFileSync(
    join(day, "IMG_0001.JPG"),
    await photo(1, { payload: `DBC1:${card?.card_code ?? ""}` }),
  );
  writeFileSync(join(day, "IMG_0002.JPG"), await photo(2));
  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = main.getByRole("region", { name: "Upload photos", exact: true });
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(day);
  await expect(sheet.getByText("Done: 2 photos added", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await page.goto(`/app/jobs/${jobId}/photos/review`);
  await expect(
    main.getByText("2 photos · 0 in Leftovers · 0 to check", { exact: true }),
  ).toBeVisible({
    timeout: 120_000,
  });
  await main.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(main.getByText("Tagging marked reviewed.", { exact: true })).toBeVisible();

  // Payouts on the fake Stripe: the account is made, then onboarding finished (the signed webhook says Active).
  expect((await page.request.post("/api/v1/studio/payouts/onboarding-link")).status()).toBe(200);
  expect(
    (await page.request.post("/api/dev-stripe", { data: { action: "finish" } })).status(),
  ).toBe(200);

  // An admin and a staff member join before the shop opens.
  const admin = await joinAs(page, browser, `live-admin-${tag}@example.test`, "admin");
  const staff = await joinAs(page, browser, `live-staff-${tag}@example.test`, "staff");

  // 2. Every item in "Before you can sell" reads Done, and the footer offers Start selling.
  await page.goto(`/app/jobs/${jobId}`);
  const heading = main.getByRole("heading", { name: jobName, level: 1, exact: true });
  await expect(heading.locator("..").getByText("Draft", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Start selling", exact: true }).click();
  const sell = page.getByRole("dialog", { name: "Before you can sell", exact: true });
  for (const item of [
    "Roster added",
    "Photos uploaded",
    "Tagging reviewed",
    "Price list chosen",
    "Payouts connected",
  ])
    await expect(
      sell
        .getByRole("listitem")
        .filter({ has: page.getByText(item, { exact: true }) })
        .getByText("Done", { exact: true }),
    ).toBeVisible();
  await expect(
    sell.getByText("Everything’s ready. Once you start selling, parents can order.", {
      exact: true,
    }),
  ).toBeVisible();

  // 2b. Tagging stops being clean behind the open dialog's back (a photo moved to Leftovers): Start selling is refused
  // by the server, the dialog says so in its status, Tagging reviewed reads To do, and focus stays in the dialog on
  // the footer's remaining button (D91, WCAG 2.4.3; code review M3). Then the photo goes back and is reviewed again.
  const photos = (await (await page.request.get(`/api/v1/jobs/${jobId}/photos`)).json()).photos as {
    id: string;
    originalFilename: string;
  }[];
  const loose = photos.find((p) => p.originalFilename === "IMG_0002.JPG")?.id as string;
  const move = (target: Record<string, string>) =>
    page.request.post(`/api/v1/jobs/${jobId}/photos/move`, {
      data: { photoIds: [loose], target },
    });
  expect((await move({ kind: "leftovers" })).status()).toBe(200);
  await sell.getByRole("button", { name: "Start selling", exact: true }).click();
  await expect(
    sell
      .getByRole("status")
      .filter({ hasText: whole("Not everything is ready yet. The list shows what’s missing.") }),
  ).toBeVisible();
  await expect(
    sell
      .getByRole("listitem")
      .filter({ has: page.getByText("Tagging reviewed", { exact: true }) })
      .getByText("To do", { exact: true }),
  ).toBeVisible();
  // The footer's Close (the dialog's own × is also named Close, and comes first).
  await expect(sell.getByRole("button", { name: "Close", exact: true }).last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sell).toBeHidden();
  expect((await move({ kind: "child", childId })).status()).toBe(200);
  expect((await page.request.post(`/api/v1/jobs/${jobId}/tagging/review`)).status()).toBe(200);
  await main.getByRole("button", { name: "Start selling", exact: true }).click();
  await expect(
    sell.getByText("Everything’s ready. Once you start selling, parents can order.", {
      exact: true,
    }),
  ).toBeVisible();

  // 3. Start selling: Selling, said in words, focus on the job's name, no confetti with reduced motion.
  await sell.getByRole("button", { name: "Start selling", exact: true }).click();
  await expect(sell).toBeHidden();
  await expect(heading.locator("..").getByText("Selling", { exact: true })).toBeVisible();
  await expect(
    main
      .getByRole("status")
      .filter({ hasText: whole(`${jobName} is live. Parents can order now.`) }),
  ).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator("[data-confetti]")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Close shop", exact: true })).toBeVisible();
  const checklist = main.getByRole("region", { name: "Checklist", exact: true });
  const showAll = checklist.getByRole("button", { name: "Show all tasks", exact: true });
  if (await showAll.isVisible()) await showAll.click();
  await expect(
    checklist
      .getByRole("listitem")
      .filter({ has: page.getByText("Start selling", { exact: true }) })
      .getByText("Done", { exact: true }),
  ).toBeVisible();

  // 4. Home's Selling now links to it (D146).
  await page.goto("/app");
  const selling = main.getByRole("region", { name: "Selling now", exact: true });
  await expect(
    selling.getByRole("link", { name: new RegExp(`^${literal(jobName)}\\s*No closing date$`) }),
  ).toHaveAttribute("href", `/app/jobs/${jobId}`);

  // 5. The admin hears about it on the bell; the row opens the job and is marked read.
  await admin.goto("/app");
  const adminMenu = admin.getByRole("complementary", { name: "Studio menu", exact: true });
  await adminMenu.getByRole("button", { name: "Notifications, 1 unread", exact: true }).click();
  const row = adminMenu.getByRole("link", {
    name: new RegExp(`^Unread, ${literal(jobName)} is live: parents can order now`),
  });
  await expect(row).toBeVisible();
  await row.click();
  await expect(admin).toHaveURL(new RegExp(`/app/jobs/${jobId}$`));
  await expect(adminMenu.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  // The owner started it, so their bell has only the payouts news; Mark all as read empties it.
  await page.reload();
  await menu.getByRole("button", { name: "Notifications, 1 unread", exact: true }).click();
  await expect(
    menu.getByRole("link", { name: /^Unread, Payouts are connected: your jobs can start selling/ }),
  ).toBeVisible();
  const markAll = menu.getByRole("button", { name: "Mark all as read", exact: true });
  await markAll.focus();
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // 6. Staff see the state but no Close shop, and the API refuses them.
  await staff.goto(`/app/jobs/${jobId}`);
  const staffMain = staff.getByRole("main");
  await expect(
    staffMain
      .getByRole("heading", { name: jobName, level: 1, exact: true })
      .locator("..")
      .getByText("Selling", { exact: true }),
  ).toBeVisible();
  await expect(staffMain.getByRole("button", { name: "Close shop", exact: true })).toHaveCount(0);
  expect((await staff.request.post(`/api/v1/jobs/${jobId}/close`)).status()).toBe(403);

  // 7. A closing date: the last day to order, shown under the name in the viewer's own time.
  await page.goto(`/app/jobs/${jobId}`);
  await main.getByRole("button", { name: "More actions", exact: true }).click();
  await main.getByRole("button", { name: "Set closing date", exact: true }).click();
  const closing = page.getByRole("dialog", { name: "Closing date", exact: true });
  const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await closing.getByLabel("Last day to order", { exact: true }).fill(inTenDays);
  await expect(
    closing.getByText(/^Closes at midnight at the end of this day, .+\.$/),
  ).toBeVisible();
  await closing.getByRole("button", { name: "Save closing date", exact: true }).click();
  await expect(closing).toBeHidden();
  await expect(
    main.getByRole("status").filter({ hasText: whole("Closing date saved.") }),
  ).toBeVisible();
  await expect(main.getByText(/ · Closes .+$/)).toBeVisible();

  // 8. Close shop, after a confirm; then Reopen shop with the same checks.
  await main.getByRole("button", { name: "Close shop", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Close the shop?", exact: true });
  await confirm.getByRole("button", { name: "Close shop", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(heading.locator("..").getByText("Closed", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("status").filter({ hasText: whole(`${jobName} is closed.`) }),
  ).toBeVisible();
  await expect(main.getByText(/ · Closes .+$/)).toHaveCount(0);
  await main.getByRole("button", { name: "Reopen shop", exact: true }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen shop", exact: true });
  await expect(
    reopen
      .getByRole("listitem")
      .filter({ has: page.getByText("Payouts connected", { exact: true }) })
      .getByText("Done", { exact: true }),
  ).toBeVisible();
  await reopen.getByRole("button", { name: "Reopen shop", exact: true }).click();
  await expect(reopen).toBeHidden();
  await expect(heading.locator("..").getByText("Selling", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("status").filter({ hasText: whole(`${jobName} is selling again.`) }),
  ).toBeVisible();

  // 9. A job that isn't ready: the server refuses, naming what is missing.
  const other = await page.request.post("/api/v1/jobs", {
    data: { name: `Not Ready ${tag}`, type: "school", pictureDay: pastDay() },
  });
  const otherId = (await other.json()).job.id as string;
  const refused = await page.request.post(`/api/v1/jobs/${otherId}/start-selling`);
  expect(refused.status()).toBe(409);
  const fields = (await refused.json()).error.fields;
  expect(fields).toMatchObject({
    form: "jobs.notReady",
    roster: "jobs.sell.roster",
    photos: "jobs.sell.photos",
    tagging: "jobs.sell.tagging",
  });
  expect(fields).not.toHaveProperty("payouts");

  // 10. Another studio's owner can't start, close or reopen it, and has no notifications of A's.
  const outsiderTab = await (await browser.newContext()).newPage();
  const outsider = await signUpOwner(outsiderTab, {
    studio: `Other Live ${tag}`,
    slug: `olive-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `live-other-${tag}@example.test`,
  });
  for (const action of ["start-selling", "close", "reopen"])
    expect((await outsider.request.post(`/api/v1/jobs/${jobId}/${action}`)).status()).toBe(404);
  const theirs = await outsider.request.get("/api/v1/notifications");
  expect(await theirs.json()).toEqual({ notifications: [], unread: 0 });
});
