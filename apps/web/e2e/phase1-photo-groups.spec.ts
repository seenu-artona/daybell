import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cardCodes, photo, signUpOwner } from "./helpers";

// Photos' Groups (D156; Seenu's answers C1-C6, C13, C15; ADR 0030) with STORAGE_DRIVER=local. A school job with classes
// 4B (Maya, Liam) and 5A (Ava), and Noah without a class. The owner makes a group for each class from the Class column
// (any roster column is offered), makes "Choir" by hand (a second "Choir" is refused) and adds Maya and Noah; an
// individual upload adds everyone it is given to to Choir (add only, C7); group photos are uploaded into Choir; on
// Choir's page one is also shown in 4B and another moved to 5A; Subjects shows the group's members (?group=<id>, an id
// only) and saves a Group chip; 5A is deleted with its photo going to Choir. Another studio sees and changes none of
// it, and can't upload into it. Desktop only (D136). Locators are scoped to main, a region or a dialog, and exact.
const run = `${Date.now()}`;

const pastDay = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

test("Photo groups: from a column, by hand, by upload, moved and shown, in Subjects, deleted, and nothing for another studio", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Groups Studio ${tag}`,
    slug: `gr-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `groups-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");

  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Groups ${tag}`, type: "school", pictureDay: pastDay() },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  const classId = async (name: string) => {
    const res = await page.request.post(`/api/v1/jobs/${jobId}/classes`, { data: { name } });
    expect(res.status()).toBe(201);
    return (await res.json()).class.id as string;
  };
  const c4b = await classId("4B");
  const c5a = await classId("5A");
  const child = async (data: Record<string, unknown>) => {
    const res = await page.request.post(`/api/v1/jobs/${jobId}/children`, { data });
    expect(res.status()).toBe(201);
    return (await res.json()).child.id as string;
  };
  await child({ firstName: "Maya", lastName: "Johnson", classId: c4b });
  await child({ firstName: "Liam", lastName: "Chen", classId: c4b });
  const ava = await child({ firstName: "Ava", lastName: "Patel", classId: c5a });
  await child({ firstName: "Noah", lastName: "Garcia" });

  // 1. Photos › Groups (the switch in the card's toolbar): none yet.
  await page.goto(`/app/jobs/${jobId}/photos`);
  const switcher = main.getByRole("navigation", { name: "Photos by", exact: true });
  await switcher.getByRole("link", { name: "Groups", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/photos/groups$`));
  await expect(switcher.getByRole("link", { name: "Groups", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    main.getByText("No groups yet. Make one, or make one for each class or grade.", {
      exact: true,
    }),
  ).toBeVisible();

  // 2. Make groups from a column: Class, with what it makes said before anything is saved (C3).
  await main.getByRole("button", { name: "Make groups from a column", exact: true }).click();
  const column = page.getByRole("dialog", { name: "Make groups from a column", exact: true });
  // Any roster column that names a group (C3): the class (in the job's word for it), grade, names and student ID.
  await expect(column.getByRole("radio")).toHaveCount(5);
  for (const name of ["Grade", "First name", "Last name", "Student ID"])
    await expect(column.getByRole("radio", { name, exact: true })).not.toBeChecked();
  await expect(column.getByRole("radio", { name: "Class", exact: true })).toBeChecked();
  await expect(column.getByText(/^Makes 2 groups: /)).toBeVisible();
  await column.getByRole("button", { name: "Make groups", exact: true }).click();
  await expect(main.getByText("Made 2 groups.", { exact: true })).toBeVisible();
  const row = (name: string) =>
    main.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(
    row("4B").getByRole("link", { name: "2 members of 4B, in Subjects", exact: true }),
  ).toBeVisible();
  await expect(
    row("5A").getByRole("link", { name: "1 member of 5A, in Subjects", exact: true }),
  ).toBeVisible();

  // 3. + New group "Choir"; a second "Choir" is refused in words.
  await main.getByRole("button", { name: "New group", exact: true }).click();
  const naming = page.getByRole("dialog", { name: "New group", exact: true });
  await naming.getByRole("textbox", { name: "Name", exact: true }).fill("Choir");
  await naming.getByRole("button", { name: "Make group", exact: true }).click();
  await expect(main.getByText("Made the group Choir.", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "New group", exact: true }).click();
  await naming.getByRole("textbox", { name: "Name", exact: true }).fill("Choir");
  await naming.getByRole("button", { name: "Make group", exact: true }).click();
  await expect(
    naming.getByText("This job already has a group with that name.", { exact: true }),
  ).toBeVisible();
  await naming.getByRole("button", { name: "Cancel", exact: true }).click();
  const choirId = (
    (await (await page.request.get(`/api/v1/jobs/${jobId}/groups`)).json()).groups as {
      id: string;
      name: string;
    }[]
  ).find((g) => g.name === "Choir")?.id as string;

  // 4. ⋯ › Add or remove people: tick Maya and Noah. Nothing changes until Save.
  await row("Choir").getByRole("button", { name: "More actions for Choir", exact: true }).click();
  await main.getByRole("button", { name: "Add or remove people", exact: true }).click();
  const members = page.getByRole("dialog", { name: "Add or remove people: Choir", exact: true });
  // Each person is named with their class beside them.
  await members.getByRole("checkbox", { name: /^Maya Johnson\s*4B$/ }).check();
  await members.getByRole("checkbox", { name: /^Noah Garcia\s*No Class$/ }).check();
  await expect(members.getByText("2 people ticked", { exact: true })).toBeVisible();
  await members.getByRole("button", { name: "Save", exact: true }).click();
  await expect(main.getByText("2 people added, 0 taken out.", { exact: true })).toBeVisible();
  await expect(
    row("Choir").getByRole("link", { name: "2 members of Choir, in Subjects", exact: true }),
  ).toBeVisible();

  // 5. An individual upload with "Add everyone in this upload to a group": Ava's card and her photo; she joins Choir
  // (add only, C7).
  expect((await page.request.post(`/api/v1/jobs/${jobId}/qr-cards`, { data: {} })).status()).toBe(
    200,
  );
  const avaCard = (await cardCodes(page, jobId)).find((c) => c.child_id === ava)?.card_code ?? "";
  const folder = mkdtempSync(join(tmpdir(), "daybell-groups-"));
  const day = join(folder, "Picture day");
  mkdirSync(day);
  writeFileSync(join(day, "IMG_0001.JPG"), await photo(31, { payload: `DBC1:${avaCard}` }));
  writeFileSync(join(day, "IMG_0002.JPG"), await photo(32));
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = main.getByRole("region", { name: "Upload photos", exact: true });
  await expect(
    sheet.getByRole("radio", { name: "Individual photos (read QR cards)", exact: true }),
  ).toBeChecked();
  await sheet
    .getByRole("combobox", { name: "Add everyone in this upload to a group", exact: true })
    .selectOption({ label: "Choir" });
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(day);
  await expect(sheet.getByText("Done: 2 photos added", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  // Members are added when the upload is tagged, after it is done.
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/v1/groups/${choirId}`)).json()).group as {
            members: number;
          }
        ).members,
      { timeout: 90_000 },
    )
    .toBe(3);
  await page.reload();
  await expect(
    row("Choir").getByRole("link", { name: "3 members of Choir, in Subjects", exact: true }),
  ).toBeVisible();

  // 6. Group photos into Choir: Group photos, then the group.
  const groupDay = join(folder, "Group photos");
  mkdirSync(groupDay);
  writeFileSync(join(groupDay, "GRP_0001.JPG"), await photo(41));
  writeFileSync(join(groupDay, "GRP_0002.JPG"), await photo(42));
  if (!(await sheet.isVisible()))
    await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  await sheet.getByRole("radio", { name: "Group photos", exact: true }).check();
  await sheet
    .getByRole("combobox", { name: "Group", exact: true })
    .selectOption({ label: "Choir" });
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(groupDay);
  await expect(sheet.getByText("Done: 2 photos added", { exact: true }).last()).toBeVisible({
    timeout: 90_000,
  });
  // Choir's row: 3 members and 2 group photos.
  await expect(row("Choir").getByRole("cell").nth(2)).toHaveText("2", { timeout: 90_000 });

  // 7. Choir's page: one photo also shown in 4B, the other moved to 5A. Group photos are never given to a person (C8).
  await row("Choir").getByRole("link", { name: "Choir", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/photos/groups/${choirId}$`));
  await expect(main.getByRole("heading", { name: "Choir", level: 2, exact: true })).toBeVisible();
  await expect(main.getByText("3 members", { exact: true })).toBeVisible();
  const groupPhotos = main.getByRole("region", { name: "Group photos", exact: true });
  await expect(groupPhotos.getByRole("img", { name: "Choir, photo 2", exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await groupPhotos.getByRole("checkbox", { name: "Select Choir, photo 1", exact: true }).check();
  await expect(main.getByRole("button", { name: "Give to a person", exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Also show in…", exact: true }).click();
  const also = page.getByRole("dialog", { name: "Also show 1 photo in…", exact: true });
  await also.getByRole("checkbox", { name: "4B", exact: true }).check();
  await also.getByRole("button", { name: "Show in groups", exact: true }).click();
  await expect(
    main.getByText("Now shown in the groups you ticked.", { exact: true }),
  ).toBeVisible();
  await groupPhotos.getByRole("checkbox", { name: "Select Choir, photo 2", exact: true }).check();
  await main.getByRole("button", { name: "Move to group", exact: true }).click();
  const move = page.getByRole("dialog", { name: "Move 1 photo to a group", exact: true });
  await move.getByRole("radio", { name: "5A", exact: true }).check();
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await expect(main.getByText("Moved 1 photo to 5A.", { exact: true })).toBeVisible();
  await expect(groupPhotos.getByRole("img", { name: "Choir, photo 2", exact: true })).toHaveCount(
    0,
  );

  // 8. Subjects shows the group's members (?group=<id>); the list has a Groups column, and "+ Add filter › Group…"
  // saves a Group chip.
  await main.getByRole("link", { name: "See them in Subjects", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/people\\?group=${choirId}$`));
  const subjectChips = main.getByRole("navigation", { name: "Show subjects", exact: true });
  await expect(subjectChips.getByRole("link", { name: "Choir", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  for (const name of ["Maya Johnson", "Noah Garcia", "Ava Patel"])
    await expect(main.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Liam Chen", exact: true })).toHaveCount(0);
  await expect(main.getByRole("columnheader", { name: "Groups", exact: true })).toBeVisible();
  await page.goto(`/app/jobs/${jobId}/people`);
  await main.getByRole("button", { name: "Add filter", exact: true }).click();
  await main.getByRole("button", { name: "Group…", exact: true }).click();
  const groupField = main.getByRole("combobox", { name: "Group", exact: true });
  await expect(groupField).toBeFocused();
  await groupField.fill("Cho");
  await main
    .getByRole("listbox", { name: "Groups", exact: true })
    .getByRole("option", { name: "Choir", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`\\?group=${choirId}$`));
  await page.reload();
  await expect(subjectChips.getByRole("link", { name: "Choir", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await main.getByRole("button", { name: "Remove filter: Choir", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/people$`));

  // 9. Delete 5A: its photo goes to Choir; its member stays on the roster.
  await page.goto(`/app/jobs/${jobId}/photos/groups`);
  await row("5A").getByRole("button", { name: "More actions for 5A", exact: true }).click();
  await main.getByRole("button", { name: "Delete", exact: true }).click();
  const deleting = page.getByRole("dialog", { name: "Delete 5A?", exact: true });
  await deleting.getByRole("radio", { name: "Another group", exact: true }).check();
  await deleting
    .getByRole("combobox", { name: "Choose a group", exact: true })
    .selectOption({ label: "Choir" });
  await deleting.getByRole("button", { name: "Delete group", exact: true }).click();
  await expect(main.getByText("Deleted the group 5A.", { exact: true })).toBeVisible();
  await expect(row("5A")).toHaveCount(0);
  await expect(row("Choir").getByRole("cell").nth(2)).toHaveText("2");

  // 10. Another studio sees and changes nothing, and can't upload into these groups.
  const someone = (
    (await (await page.request.get(`/api/v1/groups/${choirId}/photos`)).json()).photos as {
      id: string;
    }[]
  )[0]?.id as string;
  const outsiderTab = await (await browser.newContext()).newPage();
  const outsider = await signUpOwner(outsiderTab, {
    studio: `Other Groups Studio ${tag}`,
    slug: `gr-other-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `groups-other-${tag}@example.test`,
  });
  const o = outsider.request;
  expect((await o.get(`/api/v1/jobs/${jobId}/groups`)).status()).toBe(404);
  expect((await o.get(`/api/v1/groups/${choirId}`)).status()).toBe(404);
  expect((await o.get(`/api/v1/groups/${choirId}/members`)).status()).toBe(404);
  expect((await o.get(`/api/v1/groups/${choirId}/photos`)).status()).toBe(404);
  expect((await o.get(`/api/v1/jobs/${jobId}/photos/people`)).status()).toBe(404);
  expect((await o.patch(`/api/v1/groups/${choirId}`, { data: { name: "Mine" } })).status()).toBe(
    404,
  );
  expect(
    (await o.post(`/api/v1/groups/${choirId}/members`, { data: { add: [ava] } })).status(),
  ).toBe(404);
  expect(
    (
      await o.post(`/api/v1/jobs/${jobId}/photos/also-show`, {
        data: { photoIds: [someone], groupIds: [choirId] },
      })
    ).status(),
  ).toBe(404);
  expect((await o.delete(`/api/v1/groups/${choirId}`)).status()).toBe(404);
  // Their own job can't name our group: the database refuses it (409 groups.notInJob).
  const theirs = await o.post("/api/v1/jobs", {
    data: { name: `Theirs ${tag}`, type: "school", pictureDay: pastDay() },
  });
  const theirJob = (await theirs.json()).job.id as string;
  const sneaky = await o.post(`/api/v1/jobs/${theirJob}/upload-batches`, {
    data: { kind: "group", groupId: choirId },
  });
  expect(sneaky.status()).toBe(409);
  expect((await sneaky.json()).error.fields).toEqual({ form: "groups.notInJob" });
  // And Choir is still ours, as it was.
  const after = (await (await page.request.get(`/api/v1/groups/${choirId}`)).json()).group as {
    name: string;
    members: number;
  };
  expect(after).toMatchObject({ name: "Choir", members: 3 });
});
