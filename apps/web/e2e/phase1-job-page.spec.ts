import { expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 2b "Job page layout" (D136, D137, D138; ADR 0013): the one dark menu (fold, search, notifications,
// profile), the job header and tabs, Overview's journey, next step, numbers and checklist, the coming-soon tabs, and
// that search and job activity never cross studios. Desktop only (D136).
const run = `${Date.now()}`;

test("job page layout, menu search and studio separation", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const tag = `${info.project.name}-${run}`;
  const owner = `layout-owner-${tag}@example.test`;
  const page = await signUpOwner(firstTab, {
    studio: `Layout Studio ${tag}`,
    slug: `layout-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: owner,
  });
  const main = page.getByRole("main");
  const menu = page.getByRole("navigation", { name: "Main" });

  // A client and two jobs, through the API.
  const clientName = `Westbrook Academy ${tag}`;
  const client = await page.request.post("/api/v1/clients", { data: { name: clientName } });
  expect(client.status()).toBe(201);
  const clientId = (await client.json()).client.id as string;
  const jobName = `Westbrook Fall ${tag}`;
  const created = await page.request.post("/api/v1/jobs", {
    data: {
      name: jobName,
      type: "school",
      pictureDay: "2030-05-01",
      clientId,
      subjectsExpected: 50,
    },
  });
  expect(created.status()).toBe(201);
  const job = (await created.json()).job as { id: string; internalNumber: string };
  const otherName = `Unrelated Spring ${tag}`;
  expect(
    (
      await page.request.post("/api/v1/jobs", {
        data: { name: otherName, type: "sports", pictureDay: "2030-06-01" },
      })
    ).status(),
  ).toBe(201);

  // 1. Shell: one menu, no top bar, and a fixed layout that never reflows (min 1280px).
  await page.goto("/app");
  await expect(page.getByRole("banner")).toHaveCount(0);
  await page.setViewportSize({ width: 1000, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
    1280,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

  // 2. The menu folds to an icon rail and remembers it; every item keeps its name.
  await page.getByRole("button", { name: "Collapse menu" }).click();
  const expand = page.getByRole("button", { name: "Expand menu" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(menu.getByRole("link", { name: "Jobs", exact: true })).toBeVisible();
  expect((await menu.boundingBox())?.width).toBeLessThanOrEqual(64);
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
  await page.getByRole("button", { name: "Expand menu" }).click();
  await expect(page.getByRole("button", { name: "Collapse menu" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  // 3. Search: jobs by name and number, clients by name; keyboard and Escape. The text never goes in a URL.
  const searchUrls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/search") searchUrls.push(r.url());
  });
  const box = page.getByRole("combobox", { name: "Search jobs and clients" });
  const results = page.getByRole("listbox", { name: "Search results" });
  await box.fill("Westbrook");
  await expect(results.getByRole("group", { name: "Jobs" }).getByRole("option")).toHaveCount(1);
  await expect(results.getByRole("option", { name: new RegExp(jobName) })).toBeVisible();
  await expect(results.getByRole("option", { name: new RegExp(clientName) })).toBeVisible();
  expect(searchUrls.join(" ")).not.toContain("Westbrook");
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toHaveValue("Westbrook");
  await box.press("Escape");
  await expect(box).toHaveValue("");
  await box.fill(job.internalNumber);
  await expect(results.getByRole("option", { name: new RegExp(jobName) })).toBeVisible();
  await box.fill(clientName);
  // Wait for this search's own answer: the previous one (the job) must not be opened by Enter.
  await expect(results.getByRole("option", { name: new RegExp(clientName) })).toBeVisible();
  await expect(results.getByRole("option")).toHaveCount(1);
  await box.press("Enter");
  await expect(page).toHaveURL(/\/app\/contacts\/clients$/);
  const clientDialog = page.getByRole("dialog", { name: "Edit client" });
  await expect(clientDialog.getByLabel("Client name", { exact: true })).toHaveValue(clientName);
  await page.keyboard.press("Escape");
  await box.fill(`Westbrook Fall ${tag}`);
  await expect(results.getByRole("option")).toHaveCount(1);
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.id}$`));
  await expect(box).toHaveValue("");

  // 4. Notifications: an empty popover for now.
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText("No notifications yet.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // 5. Overview: header, the journey at Set up, and "Add your roster" leading to People.
  await expect(main.getByRole("heading", { name: jobName, level: 1 })).toBeVisible();
  await expect(
    main.getByText(`School · ${clientName} · May 1, 2030 · ${job.internalNumber}`, { exact: true }),
  ).toBeVisible();
  const journey = main.getByRole("list", { name: "Job journey" });
  await expect(journey.getByRole("listitem").filter({ hasText: "Set up" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  const checklist = page.getByRole("complementary", { name: "Before you can sell" });
  await expect(checklist.getByRole("listitem").filter({ hasText: "Roster added" })).toContainText(
    "To do",
  );
  await expect(
    checklist.getByRole("listitem").filter({ hasText: "Payouts connected" }),
  ).toContainText("Coming soon");
  // The job's own activity only, not the other job's, under the panel's own heading.
  await expect(checklist.getByRole("heading", { name: "Recent activity", level: 3 })).toBeVisible();
  await expect(
    checklist.getByText(`${owner} created the job ${jobName}`, { exact: true }),
  ).toBeVisible();
  await expect(checklist.getByText(otherName)).toHaveCount(0);
  // Start selling is never disabled; for now it lists what is missing.
  await main.getByRole("button", { name: "Start selling" }).click();
  const sell = page.getByRole("dialog", { name: "Before you can sell" });
  await expect(sell.getByRole("listitem").filter({ hasText: "Photos uploaded" })).toContainText(
    "Coming soon",
  );
  await sell.getByRole("button", { name: "Close" }).last().click();
  await expect(main.getByRole("heading", { name: "Add your roster" })).toBeVisible();
  await main.getByRole("link", { name: "Go to People" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.id}/people$`));

  // After adding a child: get ready for picture day, with the date and the numbers.
  await main.getByRole("button", { name: "Add child", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add child" });
  await add.getByLabel("First name", { exact: true }).fill("Maya");
  await add.getByLabel("Last name", { exact: true }).fill("Johnson");
  await add.getByRole("button", { name: "Add child", exact: true }).click();
  await expect(add).toBeHidden();
  await main.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Get ready for picture day" })).toBeVisible();
  await expect(
    main.getByText("Picture day is May 1, 2030. Check the roster before then."),
  ).toBeVisible();
  await expect(main.getByText("of 50 expected", { exact: true })).toBeVisible();
  await expect(checklist.getByRole("listitem").filter({ hasText: "Roster added" })).toContainText(
    "Done",
  );
  // The panel closes to give the list the full width, and comes back.
  await checklist.getByRole("button", { name: "Close details" }).click();
  await expect(checklist).toBeHidden();
  await main.getByRole("button", { name: "Show checklist" }).click();
  await expect(checklist).toBeVisible();

  // 6. The other tabs show coming soon inside the job's frame; an unknown tab is a 404.
  for (const name of ["Photos", "Shop", "Messages", "Orders", "Settings"]) {
    await main
      .getByRole("navigation", { name: "Job sections" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(
      main.getByRole("heading", { name: `${name} is coming soon`, level: 2 }),
    ).toBeVisible();
    await expect(main.getByRole("heading", { name: jobName, level: 1 })).toBeVisible();
  }
  const unknown = await page.goto(`/app/jobs/${job.id}/nope`);
  expect(unknown?.status()).toBe(404);

  // 7. A second studio never sees the first studio's jobs or clients, in the box or through the API, nor its
  // job's activity.
  const outsiderTab = await (await browser.newContext()).newPage();
  const outsider = await signUpOwner(outsiderTab, {
    studio: `Other Studio ${tag}`,
    slug: `other-layout-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `layout-other-${tag}@example.test`,
  });
  const otherBox = outsider.getByRole("combobox", { name: "Search jobs and clients" });
  await otherBox.fill("Westbrook");
  await expect(outsider.getByText("No jobs or clients match.", { exact: true })).toBeVisible();
  const leak = await outsider.request.post("/api/v1/search", { data: { q: jobName } });
  expect(leak.status()).toBe(200);
  expect(await leak.json()).toEqual({ jobs: [], clients: [] });
  const leakClient = await outsider.request.post("/api/v1/search", { data: { q: clientName } });
  expect(await leakClient.json()).toEqual({ jobs: [], clients: [] });
  const activity = await outsider.request.get(`/api/v1/studio/activity?jobId=${job.id}`);
  expect(activity.status()).toBe(404);
  expect((await outsider.request.get(`/api/v1/clients/${clientId}`)).status()).toBe(404);
  const short = await outsider.request.post("/api/v1/search", { data: { q: "W" } });
  expect(short.status()).toBe(400);

  // 8. The profile menu (email and studio) signs out.
  await page.goto("/app");
  await page.getByRole("button", { name: owner }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
