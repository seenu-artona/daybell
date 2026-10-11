import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 2 "Roster" (D23; ADR 0011): an owner adds a child by hand (adding a class from the combobox's last
// option), edits them, imports a CSV (an update by student ID, duplicates flagged, a bad row left out) and an Excel
// file, renames a class, removes a child, and the API refuses what it should. Roster import is desktop-only (D134;
// ADR 0012): on a phone the test adds, edits and removes children by hand and checks the import page shows a notice.
// Adding and importing write codes through the server-only path (the app's SUPABASE_SECRET_KEY_CA, which CI takes
// from the local Supabase stack).
// The CI database is Canadian (D122), so every access code starts with a symbol from the Canadian set.
//
// e2e/fixtures/roster.xlsx (2 KB) was made once with Python's zipfile: one sheet "Roster" with the header
// First Name, Last Name, Class, Student ID, Grade and five rows (Olivia Brown 4C S-101 4, Ethan Davis 4C S-102 4,
// Sophia Wilson Room 5 S-103 5, Lucas Martin Room 5 S-104 5, Amelia Clark Room 5 S-105 5); grades are numbers.
const run = `${Date.now()}`;
const CA_CODE = /^[JKMNP-Z][2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{4}$/;
const XLSX = fileURLToPath(new URL("./fixtures/roster.xlsx", import.meta.url));

const CSV = [
  "Student First Name,Student Last Name,Homeroom,Student #,Grade,Parent Email,Photo Opt Out",
  // Matches Maya by student ID: an update that moves her to 4C and keeps her code.
  "Maya,Johnson-Lee,4C,S-001,,,",
  // Same name, same class, no student ID: duplicates.
  "Liam,Chen,4C,,4,,",
  "liam,CHEN,4C,,4,,",
  // Same student ID: duplicates.
  "Ava,Patel,4C,S-050,4,,Parent request",
  "Noah,Garcia,4C,S-050,4,,",
  // A blank line, then a bad email: can't be imported, shown as row 8 of the file.
  "",
  "Emma,Brooks,4C,S-060,4,not-an-email,",
].join("\n");

test("owner builds a roster by hand and from CSV and Excel files", async ({
  page: firstTab,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${info.project.name}-${run}`;
  const owner = `roster-owner-${tag}@example.test`;
  const jobName = `Roster School ${tag}`;
  const page = await signUpOwner(firstTab, {
    studio: `Roster Studio ${tag}`,
    slug: `roster-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: owner,
  });
  // The phone header and the desktop top bar both exist; look inside the page's main area only.
  const main = page.getByRole("main");
  const roster = main.getByRole("region", { name: "Roster" });
  const rosterStatus = roster.getByRole("status");

  // 1. A school job, created through the API; its roster starts empty.
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: jobName, type: "school", pictureDay: "2026-10-14" },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  // The job page loads its job once, not in a loop (a translator that changed every render once refetched forever).
  let jobLoads = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === `/api/v1/jobs/${jobId}`) jobLoads++;
  });
  await page.goto(`/app/jobs/${jobId}`);
  await expect(roster.getByRole("heading", { name: "No children yet" })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(jobLoads).toBeLessThanOrEqual(2);

  // 2. Add a child by hand, adding the class "4B" from the combobox's last option.
  await roster.getByRole("button", { name: "Add child", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add child" });
  await add.getByLabel("First name", { exact: true }).fill("Maya");
  await add.getByLabel("Last name", { exact: true }).fill("Johnson");
  const combobox = add.getByRole("combobox", { name: "Class (optional)" });
  await combobox.fill("4B");
  await add
    .getByRole("listbox", { name: "Classes" })
    .getByRole("option", { name: "Add new class" })
    .click();
  const addClass = page.getByRole("dialog", { name: "Add class" });
  await expect(addClass.getByLabel("Name", { exact: true })).toHaveValue("4B");
  await addClass.getByRole("button", { name: "Add class", exact: true }).click();
  await expect(addClass).toBeHidden();
  await expect(combobox).toHaveValue("4B");
  await add.getByText("More options", { exact: true }).click();
  await add.getByLabel(/^Student ID/).fill("S-001");
  await add.getByLabel(/^Grade/).fill("4");
  await add.getByLabel(/^Parent email/).fill("maya.parent@example.test");
  await add.getByLabel("Do not photograph", { exact: true }).check();
  await add.getByRole("button", { name: "Add child", exact: true }).click();
  await expect(add).toBeHidden();
  await expect(rosterStatus).toHaveText("Saved.");
  const maya = roster.getByRole("row").filter({ hasText: "Maya Johnson" });
  await expect(maya).toContainText("Do not photograph");
  await expect(maya.getByRole("cell").nth(1)).toHaveText("4B");
  // The access code is always visible to the studio (Seenu #2).
  const codeCell = maya.getByRole("cell").nth(4);
  await expect(codeCell).toHaveText(CA_CODE);
  const mayaCode = ((await codeCell.textContent()) ?? "").trim();
  // The roster table scrolls inside its own box; nothing in it may widen the page (D72). When the sr-only actions
  // header escaped the box, the phone's layout viewport grew past the screen and taps landed on the wrong element.
  if (info.project.use.isMobile) {
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      layout: window.innerWidth,
      screen: document.documentElement.clientWidth,
    }));
    expect(widths.page).toBeLessThanOrEqual(widths.screen);
    expect(widths.layout).toBe(widths.screen);
  }

  // 3. Edit her grade in the same form, which shows her code.
  await maya.getByRole("button", { name: "Edit Maya Johnson" }).click();
  const edit = page.getByRole("dialog", { name: "Edit child" });
  await expect(edit.getByText(mayaCode, { exact: true })).toBeVisible();
  await edit.getByText("More options", { exact: true }).click();
  await edit.getByLabel(/^Grade/).fill("5");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(rosterStatus).toHaveText("Saved.");
  await expect(maya.getByRole("cell").nth(3)).toHaveText("5");

  const desktop = !info.project.use.isMobile;
  if (!desktop) {
    // 3b. On a phone, "Import roster" leads to the desktop-only notice and a way back (D134).
    await roster.getByRole("link", { name: "Import roster" }).click();
    await expect(main.getByRole("heading", { name: "Import roster", level: 1 })).toBeVisible();
    await expect(
      main.getByText("Open this on a computer to import a roster.", { exact: true }),
    ).toBeVisible();
    await expect(main.getByLabel("Roster file (CSV or Excel)")).toBeHidden();
    await main.getByRole("link", { name: "Back to job" }).click();
    await expect(maya).toBeVisible();
  }

  if (desktop) {
    // 4. Import a CSV: columns are guessed, rows checked on the server, then imported together.
    await roster.getByRole("link", { name: "Import roster" }).click();
    await expect(main.getByRole("heading", { name: "Import roster", level: 1 })).toBeVisible();
    await main.getByLabel("Roster file (CSV or Excel)").setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV),
    });
    await expect(main.getByLabel("Import “Student First Name” as")).toHaveValue("firstName");
    await expect(main.getByLabel("Import “Homeroom” as")).toHaveValue("group");
    await expect(main.getByLabel("Import “Student #” as")).toHaveValue("studentId");
    await expect(main.getByLabel("Import “Photo Opt Out” as")).toHaveValue("doNotPhotograph");
    await main.getByRole("button", { name: "Check rows" }).click();
    await expect(
      main.getByText(
        "4 will be added · 1 updated · 1 new class · 4 duplicates · 1 row can't be imported",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(main.getByRole("row").filter({ hasText: "Maya Johnson-Lee" })).toContainText(
      "Update",
    );
    await expect(main.getByRole("row").filter({ hasText: "Ava Patel" })).toContainText("Duplicate");
    await expect(main.getByRole("row").filter({ hasText: "Ava Patel" })).toContainText(
      "Do not photograph",
    );
    const emma = main.getByRole("row").filter({ hasText: "Emma Brooks" });
    await expect(emma).toContainText("Can't import");
    // Row numbers match the file, blank lines included.
    await expect(emma.getByRole("cell").first()).toHaveText("8");
    await main.getByText("Duplicates", { exact: true }).click();
    await expect(main.getByRole("row").filter({ hasText: "Emma Brooks" })).toHaveCount(0);
    await main.getByRole("button", { name: "Import 5 children" }).click();

    await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}$`));
    await expect(rosterStatus).toHaveText("Roster imported: 4 added, 1 updated.");
    const mayaAfter = roster.getByRole("row").filter({ hasText: "Maya Johnson-Lee" });
    await expect(mayaAfter.getByRole("cell").nth(1)).toHaveText("4C");
    // Updated by student ID: same child, same code; the blank grade cell kept her grade.
    await expect(mayaAfter.getByRole("cell").nth(4)).toHaveText(mayaCode);
    await expect(mayaAfter.getByRole("cell").nth(3)).toHaveText("5");
    await expect(roster.getByText("4 duplicates", { exact: true })).toBeVisible();

    // 5. Import an Excel file.
    await roster.getByRole("link", { name: "Import roster" }).click();
    await main.getByLabel("Roster file (CSV or Excel)").setInputFiles(XLSX);
    await expect(main.getByLabel("Import “Student ID” as")).toHaveValue("studentId");
    await main.getByRole("button", { name: "Check rows" }).click();
    await expect(
      main.getByText(
        "5 will be added · 0 updated · 1 new class · 0 duplicates · 0 rows can't be imported",
        { exact: true },
      ),
    ).toBeVisible();
    await main.getByRole("button", { name: "Import 5 children" }).click();
    await expect(rosterStatus).toHaveText("Roster imported: 5 added, 0 updated.");
    await expect(roster.getByRole("cell", { name: "Olivia Brown", exact: true })).toBeVisible();
    await expect(roster.getByRole("cell", { name: "Sophia Wilson", exact: true })).toBeVisible();

    // 6. Filter to one class and rename it. The filter stays on screen and keeps focus while the list loads.
    const filter = roster.getByLabel("Class", { exact: true });
    await filter.focus();
    await filter.selectOption({ label: "4C" });
    await expect(roster.getByRole("cell", { name: "Sophia Wilson", exact: true })).toHaveCount(0);
    await expect(roster.getByRole("cell", { name: "Olivia Brown", exact: true })).toBeVisible();
    await expect(filter).toBeFocused();
    await roster.getByRole("button", { name: "Rename class" }).click();
    const rename = page.getByRole("dialog", { name: "Rename class" });
    await rename.getByLabel("Name", { exact: true }).fill("Room 4C");
    await rename.getByRole("button", { name: "Save changes" }).click();
    await expect(rename).toBeHidden();
    await expect(filter.locator("option:checked")).toHaveText("Room 4C");

    await filter.selectOption({ label: "All classes" });
  }

  // 7. Remove a child while the job is a draft: one the CSV added on desktop, one added by hand on a phone.
  let removed = "Noah Garcia";
  if (!desktop) {
    removed = "Liam Chen";
    await roster.getByRole("button", { name: "Add child", exact: true }).click();
    await add.getByLabel("First name", { exact: true }).fill("Liam");
    await add.getByLabel("Last name", { exact: true }).fill("Chen");
    await add.getByRole("button", { name: "Add child", exact: true }).click();
    await expect(add).toBeHidden();
    await expect(rosterStatus).toHaveText("Saved.");
  }
  await roster.getByRole("button", { name: `Edit ${removed}` }).click();
  const editRemoved = page.getByRole("dialog", { name: "Edit child" });
  await editRemoved.getByRole("button", { name: "Remove child", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Remove child?" });
  await expect(confirm).toContainText(
    `${removed} and their access code will be deleted. This can't be undone.`,
  );
  await confirm.getByRole("button", { name: "Remove child", exact: true }).click();
  await expect(editRemoved).toBeHidden();
  await expect(rosterStatus).toHaveText("Child removed.");
  await expect(roster.getByRole("cell", { name: removed, exact: true })).toHaveCount(0);

  // 8. The activity log shows one line per import, naming the job by looking it up (D96).
  if (desktop) {
    await page.goto("/app");
    await expect(
      main.getByText(`${owner} imported a roster into ${jobName}`, { exact: true }).first(),
    ).toBeVisible();
  }

  // 9. The API refuses bad input, never exposes code hashes, and takes 5,000 rows at most.
  const empty = await page.request.post(`/api/v1/jobs/${jobId}/children`, {
    data: { firstName: "", lastName: "Brooks" },
  });
  expect(empty.status()).toBe(400);
  expect((await empty.json()).error.fields.firstName).toBe("validation.firstName");
  const control = await page.request.post(`/api/v1/jobs/${jobId}/children`, {
    data: { firstName: "Ma\u0000ya", lastName: "Brooks" },
  });
  expect(control.status()).toBe(400);
  expect((await control.json()).error.fields.firstName).toBe("validation.firstName");
  const list = await page.request.get(`/api/v1/jobs/${jobId}/children`);
  expect(list.status()).toBe(200);
  const listText = await list.text();
  expect(listText).not.toContain("access_code_hash");
  expect(listText).not.toContain("ciphertext");
  const children = JSON.parse(listText).children as { id: string; accessCode: string | null }[];
  // Desktop: 1 by hand + 4 from the CSV + 5 from Excel - 1 removed. Phone: Maya.
  expect(children).toHaveLength(desktop ? 9 : 1);
  for (const c of children) expect(c.accessCode).toMatch(CA_CODE);
  const codeChange = await page.request.patch(`/api/v1/children/${children[0]?.id}`, {
    data: { accessCode: "K7QM-4XPA" },
  });
  expect(codeChange.status()).toBe(400);
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      firstName: "Load",
      lastName: `Test ${i}`,
      group: `Load ${i % 20}`,
      studentId: `L-${i}`,
    }));
  const tooMany = await page.request.post(`/api/v1/jobs/${jobId}/children/import`, {
    data: { rows: rows(5001), dryRun: true },
  });
  expect(tooMany.status()).toBe(400);
  expect((await tooMany.json()).error.fields.rows).toBe("validation.rosterTooLarge");

  // A full-size import (performance smoke test), into its own job, once.
  if (desktop) {
    const big = await page.request.post("/api/v1/jobs", {
      data: { name: `Load ${tag}`, type: "school", pictureDay: "2026-10-14" },
    });
    const bigJob = (await big.json()).job.id as string;
    const imported = await page.request.post(`/api/v1/jobs/${bigJob}/children/import`, {
      data: { rows: rows(5000) },
      timeout: 120_000,
    });
    expect(imported.status()).toBe(200);
    expect(await imported.json()).toMatchObject({ added: 5000, updated: 0, groupsAdded: 20 });
    // 5,020 hidden child and class events don't push the shown ones out of the latest 50 (filtered before the limit).
    await page.goto("/app");
    await expect(
      main.getByText(`${owner} imported a roster into Load ${tag}`, { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText(`${owner} imported a roster into ${jobName}`, { exact: true }).first(),
    ).toBeVisible();
  }
});
