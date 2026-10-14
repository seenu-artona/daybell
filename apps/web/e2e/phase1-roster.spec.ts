import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 2 "Roster" (D23; ADR 0011), in the job's People section since step 2b (D137, D138; ADR 0013),
// restyled in step 2c (D140; ADR 0014) and relabelled Subjects with one view bar (D144; ADR 0025): an owner adds a
// child by hand (adding a class from the combobox's last option), opens and edits them in the floating panel, imports
// a CSV (an update by student ID, duplicates flagged, a bad row left out) and an Excel file, searches, and uses the
// chips (D147): Possible duplicates, a class added from "+ Add filter" (saved, kept after a reload, removed with its own
// button), a grade (this browser only), No photos and Not ordered, with Photos and Ordered columns; renames a class from
// the Classes row's panel; then removes children from the panel and from the form, and the API refuses what it should.
// Desktop only (D136). The 5,000-row import is in phase1-roster-load.
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

test("owner builds a roster in People by hand and from CSV and Excel files", async ({
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
  const main = page.getByRole("main");
  const row = (name: string) => main.getByRole("row").filter({ hasText: name });
  // Columns: name, class, student ID, grade, access code, photos, ordered (D147).
  const classOf = (name: string) => row(name).getByRole("cell").nth(1);

  // 1. A school job, created through the API; its People section starts empty.
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: jobName, type: "school", pictureDay: "2026-10-14" },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  const people = new RegExp(`/app/jobs/${jobId}/people$`);
  // The job loads once for all its sections, not in a loop (a translator that changed every render once refetched
  // forever), and not again when moving between tabs or to Import and back.
  let jobLoads = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === `/api/v1/jobs/${jobId}`) jobLoads++;
  });
  await page.goto(`/app/jobs/${jobId}/people`);
  await expect(main.getByRole("heading", { name: "No children yet" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Subjects", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.waitForTimeout(1_500);
  expect(jobLoads).toBeLessThanOrEqual(2);

  // 2. Add a child by hand from the green Add subjects menu, adding the class "4B" from the combobox's last option.
  await main.getByRole("button", { name: "Add subjects", exact: true }).click();
  await main.getByRole("button", { name: "Add child", exact: true }).click();
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
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();
  const maya = row("Maya Johnson");
  await expect(maya).toContainText("Do not photograph");
  await expect(classOf("Maya Johnson")).toHaveText("4B");
  await expect(main.getByRole("heading", { name: "1 child", level: 2 })).toBeVisible();
  // The count is in the list card's footer, not on the tab (D144).
  await expect(main.getByText("1 child · 1 class · no duplicates", { exact: true })).toBeVisible();
  // The access code is always visible to the studio (Seenu #2).
  const codeCell = maya.getByRole("cell").nth(4);
  await expect(codeCell).toHaveText(CA_CODE);
  const mayaCode = ((await codeCell.textContent()) ?? "").trim();

  // 3. Open her in the floating panel. Only her id goes in the URL; the panel survives a refresh.
  await maya.getByRole("link", { name: "Maya Johnson", exact: true }).click();
  await expect(page).toHaveURL(/\?child=[0-9a-f-]{36}$/);
  let panel = page.getByRole("complementary", { name: "Maya Johnson" });
  await expect(panel.getByRole("heading", { name: "Maya Johnson", exact: true })).toBeFocused();
  await expect(panel.getByText(mayaCode, { exact: true })).toBeVisible();
  expect(page.url()).not.toContain("Maya");
  await page.reload();
  panel = page.getByRole("complementary", { name: "Maya Johnson" });
  await expect(panel).toBeVisible();
  // Edit her grade in the same form, from the panel.
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit child" });
  await expect(edit.getByText(mayaCode, { exact: true })).toBeVisible();
  await edit.getByText("More options", { exact: true }).click();
  await edit.getByLabel(/^Grade/).fill("5");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(maya.getByRole("cell").nth(3)).toHaveText("5");
  await panel.getByRole("button", { name: "Close details" }).click();
  await expect(page).toHaveURL(people);
  await expect(panel).toBeHidden();
  await expect(maya.getByRole("link", { name: "Maya Johnson", exact: true })).toBeFocused();
  // The panel floats over the table: 400px wide, as tall as its content (shorter than the window). Escape, with focus
  // inside it, closes it too, and focus returns to her name.
  await maya.getByRole("link", { name: "Maya Johnson", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Maya Johnson", exact: true })).toBeFocused();
  const panelBox = await panel.boundingBox();
  expect(panelBox?.width).toBe(400);
  // As tall as its content: nothing scrolls inside it, and it doesn't stretch down the page like a full-height panel.
  const fits = await panel.evaluate((el) => el.scrollHeight <= el.clientHeight);
  expect(fits).toBe(true);
  const mainBox = await main.boundingBox();
  expect(panelBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(mainBox?.height ?? 0);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(people);
  await expect(maya.getByRole("link", { name: "Maya Johnson", exact: true })).toBeFocused();

  // 4. Import a CSV: a full page in the job's frame (no phone notice, D136). Columns are guessed, rows checked on
  // the server, then imported together; it lands back on People.
  await main.getByRole("button", { name: "Add subjects", exact: true }).click();
  await main.getByRole("link", { name: "Import roster" }).click();
  await expect(main.getByRole("heading", { name: "Import roster", level: 2 })).toBeVisible();
  await expect(main.getByRole("heading", { name: jobName, level: 1 })).toBeVisible();
  await expect(main.getByRole("link", { name: "Subjects", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
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
  await expect(row("Maya Johnson-Lee")).toContainText("Update");
  await expect(row("Ava Patel")).toContainText("Duplicate");
  await expect(row("Ava Patel")).toContainText("Do not photograph");
  const emma = row("Emma Brooks");
  await expect(emma).toContainText("Can't import");
  // Row numbers match the file, blank lines included.
  await expect(emma.getByRole("cell").first()).toHaveText("8");
  await main.getByText("Duplicates", { exact: true }).click();
  await expect(row("Emma Brooks")).toHaveCount(0);
  await main.getByRole("button", { name: "Import 5 children" }).click();

  await expect(page).toHaveURL(people);
  await expect(
    main.getByText("Roster imported: 4 added, 1 updated.", { exact: true }),
  ).toBeVisible();
  // Updated by student ID: same child, same code, now in 4C; the blank grade cell kept her grade.
  await expect(classOf("Maya Johnson-Lee")).toHaveText("4C");
  const mayaAfter = row("Maya Johnson-Lee");
  await expect(mayaAfter.getByRole("cell").nth(4)).toHaveText(mayaCode);
  await expect(mayaAfter.getByRole("cell").nth(3)).toHaveText("5");
  await expect(main.getByText("4 possible duplicates", { exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { name: "5 children", level: 2 })).toBeVisible();
  await expect(main.getByText(/^5 children · \d+ classes · 4 possible duplicates$/)).toBeVisible();

  // 5. Import an Excel file.
  await main.getByRole("button", { name: "Add subjects", exact: true }).click();
  await main.getByRole("link", { name: "Import roster" }).click();
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
  await expect(
    main.getByText("Roster imported: 5 added, 0 updated.", { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toBeVisible();
  // The name link is a 44px target (D91) in a 60px row; the filter and search buttons are 44px round.
  const target = await main.getByRole("link", { name: "Olivia Brown", exact: true }).boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect(target?.width).toBeGreaterThanOrEqual(44);
  const rowBox = await row("Olivia Brown").boundingBox();
  expect(Math.round(rowBox?.height ?? 0)).toBeGreaterThanOrEqual(60);
  expect(rowBox?.height ?? 0).toBeLessThan(62);
  // The section's actions sit at the right end of the job's tab row (D147): the white Print QR cards, then the green
  // Add subjects. The chips and the 44px search are in the list card's toolbar.
  const tabRow = await main
    .getByRole("navigation", { name: "Job sections", exact: true })
    .boundingBox();
  const printBox = await main
    .getByRole("button", { name: "Print QR cards", exact: true })
    .boundingBox();
  const addBox = await main
    .getByRole("button", { name: "Add subjects", exact: true })
    .boundingBox();
  const middle = (box: { y: number; height: number } | null) =>
    (box?.y ?? 0) + (box?.height ?? 0) / 2;
  expect(Math.abs(middle(printBox) - middle(tabRow))).toBeLessThan(4);
  expect(printBox?.x ?? 0).toBeLessThan(addBox?.x ?? 0);
  const chips = main.getByRole("navigation", { name: "Show subjects", exact: true });
  await expect(chips.getByRole("link", { name: "All", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  const allBox = await chips.getByRole("link", { name: "All", exact: true }).boundingBox();
  expect(allBox?.height).toBeGreaterThanOrEqual(44);
  const searchBox = await main.getByRole("button", { name: "Search children" }).boundingBox();
  expect(searchBox?.width).toBe(44);
  expect(searchBox?.height).toBe(44);
  // Photos and Ordered columns: nobody has photos or orders yet.
  await expect(main.getByRole("columnheader", { name: "Photos", exact: true })).toBeVisible();
  await expect(
    row("Olivia Brown").getByRole("cell", { name: "Not yet", exact: true }),
  ).toBeVisible();
  await expect(classOf("Sophia Wilson")).toHaveText("Room 5");
  expect(jobLoads).toBeLessThanOrEqual(2);

  // 6. Search, views and filters (combined with AND) and grouping. The search, class and grade stay in the
  // browser; the view is in the address as an enum word (?show=, D113).
  await main.getByRole("button", { name: "Search children" }).click();
  const search = main.getByRole("searchbox", { name: "Search children" });
  await expect(search).toBeFocused();
  await search.fill("olivia");
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Sophia Wilson", exact: true })).toHaveCount(0);
  await search.fill(mayaCode.replace("-", ""));
  await expect(main.getByRole("link", { name: "Maya Johnson-Lee", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toHaveCount(0);
  await search.fill("");
  // Escape on the empty box closes it and puts focus back on the search button.
  await search.press("Escape");
  await expect(main.getByRole("button", { name: "Search children" })).toBeFocused();
  expect(page.url()).not.toContain("olivia");

  // The duplicates notice switches to the Possible duplicates chip.
  await main.getByRole("button", { name: "Show them" }).click();
  await expect(page).toHaveURL(/\?show=duplicates$/);
  await expect(chips.getByRole("link", { name: "Possible duplicates" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(main.getByRole("link", { name: "Ava Patel", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toHaveCount(0);
  await chips.getByRole("link", { name: "All", exact: true }).click();
  await expect(page).toHaveURL(people);

  // No photos and Not ordered: nobody has either yet, so everyone shows.
  await chips.getByRole("link", { name: "No photos", exact: true }).click();
  await expect(page).toHaveURL(/\?show=noPhotos$/);
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toBeVisible();
  await chips.getByRole("link", { name: "Not ordered", exact: true }).click();
  await expect(page).toHaveURL(/\?show=notOrdered$/);
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toBeVisible();

  // + Add filter: "Show only" lists each class, No class, Grade… and the two flags. A class becomes a chip of the
  // person's own for this job: in the address as its id only (?class=<id>, D113), kept after a reload.
  const addFilter = main.getByRole("button", { name: "Add filter", exact: true });
  await addFilter.click();
  await expect(main.getByText("Show only", { exact: true })).toBeVisible();
  for (const choice of [
    "4C",
    "Room 5",
    "No class",
    "Grade…",
    "Do not photograph",
    "Do not publish",
  ])
    await expect(main.getByRole("button", { name: choice, exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Room 5", exact: true }).click();
  await expect(page).toHaveURL(/\?class=[0-9a-f-]{36}$/);
  await expect(addFilter).toBeFocused();
  await expect(main.getByRole("link", { name: "Sophia Wilson", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(chips.getByRole("link", { name: "Room 5", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // A grade is a chip in this browser only: never in the address, never saved.
  await addFilter.click();
  await main.getByRole("button", { name: "Grade…", exact: true }).click();
  const gradeField = main.getByRole("combobox", { name: "Grade", exact: true });
  await expect(gradeField).toBeFocused();
  await gradeField.press("ArrowDown");
  await main
    .getByRole("listbox", { name: "Grades" })
    .getByRole("option", { name: "4", exact: true })
    .click();
  await expect(chips.getByRole("button", { name: "Grade 4", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page).toHaveURL(people);
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Sophia Wilson", exact: true })).toHaveCount(0);
  // One chip at a time (D147): Do not photograph replaces the grade, and lists the children opted out (Ava Patel, from
  // the CSV's "Photo Opt Out"), not those in grade 4 or Room 5.
  await addFilter.click();
  await main.getByRole("button", { name: "Do not photograph", exact: true }).click();
  await expect(page).toHaveURL(/\?show=doNotPhotograph$/);
  await expect(chips.getByRole("button", { name: "Grade 4", exact: true })).not.toHaveAttribute(
    "aria-current",
  );
  await expect(main.getByRole("link", { name: "Ava Patel", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Sophia Wilson", exact: true })).toHaveCount(0);

  // An added chip's own remove button takes it away (back to All when it was selected); built-in chips have none.
  await main.getByRole("button", { name: "Remove filter: Do not photograph", exact: true }).click();
  await expect(page).toHaveURL(people);
  await main.getByRole("button", { name: "Remove filter: Room 5", exact: true }).click();
  await expect(chips.getByRole("link", { name: "Room 5", exact: true })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Remove filter: All" })).toHaveCount(0);
  await page.reload();
  await expect(chips.getByRole("link", { name: "Room 5", exact: true })).toHaveCount(0);
  await expect(chips.getByRole("button", { name: "Grade 4", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Olivia Brown", exact: true })).toBeVisible();

  // 7. Rename a class from the Classes row under the list (D147: Group by is gone): it opens the job's classes in the
  // panel, each with Rename; focus comes back to the class's Rename button.
  const classesRow = main.getByRole("button", { name: /^Classes ?\d+$/ });
  await classesRow.click();
  await expect(classesRow).toHaveAttribute("aria-expanded", "true");
  const classesPanel = page.getByRole("complementary", { name: "This job's classes" });
  await classesPanel.getByRole("button", { name: "Rename class 4C", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename class" });
  await rename.getByLabel("Name", { exact: true }).fill("Room 4C");
  await rename.getByRole("button", { name: "Save changes" }).click();
  await expect(rename).toBeHidden();
  await expect(
    classesPanel.getByRole("button", { name: "Rename class Room 4C", exact: true }),
  ).toBeFocused();
  await expect(classOf("Olivia Brown")).toHaveText("Room 4C");
  await page.keyboard.press("Escape");
  await expect(classesRow).toBeFocused();

  // 8. Remove children while the job is a draft: one from the panel's ⋯ menu, one from the child form.
  await row("Noah Garcia").getByRole("cell").nth(1).click();
  panel = page.getByRole("complementary", { name: "Noah Garcia" });
  await panel.getByRole("button", { name: "More actions for Noah Garcia" }).click();
  await panel.getByRole("button", { name: "Remove child" }).click();
  let confirm = page.getByRole("dialog", { name: "Remove child?" });
  await expect(confirm).toContainText(
    "Noah Garcia and their access code will be deleted. This can't be undone.",
  );
  await confirm.getByRole("button", { name: "Remove child", exact: true }).click();
  await expect(main.getByText("Child removed.", { exact: true })).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(main.getByRole("link", { name: "Noah Garcia", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(people);

  await row("Ava Patel").getByRole("link", { name: "Ava Patel", exact: true }).click();
  panel = page.getByRole("complementary", { name: "Ava Patel" });
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const editAva = page.getByRole("dialog", { name: "Edit child" });
  await editAva.getByRole("button", { name: "Remove child", exact: true }).click();
  confirm = page.getByRole("dialog", { name: "Remove child?" });
  await confirm.getByRole("button", { name: "Remove child", exact: true }).click();
  await expect(editAva).toBeHidden();
  await expect(main.getByRole("link", { name: "Ava Patel", exact: true })).toHaveCount(0);
  await expect(main.getByText(/^8 children · /)).toBeVisible();

  // 9. The job's Overview shows one activity line per import, naming the job by looking it up (D96).
  await main.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    main
      .getByRole("region", { name: "Recent activity" })
      .getByText(`${owner} imported a roster into ${jobName}`, { exact: true })
      .first(),
  ).toBeVisible();

  // 10. The API refuses bad input, never exposes code hashes, and takes 5,000 rows at most.
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
  // 1 by hand + 4 from the CSV + 5 from Excel - 2 removed.
  expect(children).toHaveLength(8);
  for (const c of children) expect(c.accessCode).toMatch(CA_CODE);
  const codeChange = await page.request.patch(`/api/v1/children/${children[0]?.id}`, {
    data: { accessCode: "K7QM-4XPA" },
  });
  expect(codeChange.status()).toBe(400);
  const tooMany = await page.request.post(`/api/v1/jobs/${jobId}/children/import`, {
    data: {
      rows: Array.from({ length: 5001 }, (_, i) => ({ firstName: "Load", lastName: `Test ${i}` })),
      dryRun: true,
    },
  });
  expect(tooMany.status()).toBe(400);
  expect((await tooMany.json()).error.fields.rows).toBe("validation.rosterTooLarge");
});
