import { expect, test } from "@playwright/test";
import { buy, joinAs, studioSellingAva } from "./helpers";

// People (D150; Seenu's answers 1-6 of Oct 14, 2026; ADR 0028) on the desktop app with STRIPE_DRIVER=fake. A studio
// sells one job with Ava Patel, whose parent buys a print (D148: she has ordered); a second job, for a client with a
// contact person, has Ben Ortiz, who hasn't. The owner walks the four tabs: Clients (main contact, jobs, latest job;
// the All chip only), Contacts (the client's contact is its main one; a new contact made main takes over, on the client
// and its row in Clients too; the main contact's box is locked; another made main from the Edit dialog swaps back; a
// client chip from "+ Add filter" is saved, kept after a reload and removed), Families (coming soon) and Subjects (both
// subjects across the two jobs, Ordered and Not ordered chips, a job chip saved, kept and removed, the search kept out
// of the address, a row opening the subject on their job). A photographer sees no Families tab, no order data and the
// contact dialog read-only. Locators are scoped to main, a region or a dialog, and exact.

const run = `${Date.now()}`;

test("People: clients, contacts made main, families coming soon, subjects across jobs with Ordered chips", async ({
  browser,
}, info) => {
  test.setTimeout(360_000);
  const tag = `${info.project.name}-${run}`;
  const baseURL = info.project.use.baseURL as string;
  const { context, page, jobId, code } = await studioSellingAva(browser, baseURL, tag);
  const main = page.getByRole("main");

  // 1. Ava's parent buys a print, delivered to school (the job delivers to school).
  const parent = await browser.newContext({ baseURL });
  const shop = parent.request;
  const opened = await shop.post("/api/v1/shop/access", { data: { code } });
  expect(opened.status()).toBe(201);
  const { childId, galleryId } = (await opened.json()) as { childId: string; galleryId: string };
  const q = `gallery=${galleryId}`;
  const portraits = (await (await shop.get(`/api/v1/shop/children/${childId}/gallery?${q}`)).json())
    .portraits as { id: string }[];
  const items = (await (await shop.get(`/api/v1/shop/children/${childId}/price-list?${q}`)).json())
    .priceList.items as { id: string; name: string }[];
  const print = items.find((i) => i.name === "5×7 print")?.id as string;
  await buy(
    shop,
    q,
    [{ childId, itemId: print, photoId: portraits[0]?.id as string }],
    "school",
    tag,
  );
  await parent.close();

  // 2. A client with a contact person, a second job for it, and Ben on its roster.
  const clientName = `Lincoln SD ${tag}`;
  const madeClient = await page.request.post("/api/v1/clients", {
    data: {
      name: clientName,
      country: "CA",
      contactFirstName: "Dana",
      contactLastName: "Ruiz",
      contactEmail: `dana-${tag}@lincoln.example`,
    },
  });
  expect(madeClient.status()).toBe(201);
  const clientId = (await madeClient.json()).client.id as string;
  const jobName = `Spring Minis ${tag}`;
  const madeJob = await page.request.post("/api/v1/jobs", {
    data: { name: jobName, type: "school", pictureDay: "2027-04-02", clientId },
  });
  expect(madeJob.status()).toBe(201);
  const job2 = (await madeJob.json()).job.id as string;
  expect(
    (
      await page.request.post(`/api/v1/jobs/${job2}/children`, {
        data: { firstName: "Ben", lastName: "Ortiz" },
      })
    ).status(),
  ).toBe(201);

  // 3. People opens on Clients: the h1, the four tabs (links, the current one marked) and the section's line. The
  // client row has its main contact, one job and that job as its latest, linked; no type and no money.
  await page.goto("/app/people");
  await expect(page).toHaveURL(/\/app\/people\/clients$/);
  await expect(main.getByRole("heading", { name: "People", level: 1, exact: true })).toBeVisible();
  const tabs = main.getByRole("navigation", { name: "People sections", exact: true });
  await expect(tabs.getByRole("link")).toHaveText(["Clients", "Contacts", "Families", "Subjects"]);
  await expect(tabs.getByRole("link", { name: "Clients", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    main.getByText("Schools, preschools and teams you photograph", { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("button", { name: "New client", exact: true })).toBeVisible();
  for (const name of ["Client", "Main contact", "Jobs", "Latest job"])
    await expect(main.getByRole("columnheader", { name, exact: true })).toBeVisible();
  await expect(main.getByRole("columnheader", { name: "Type", exact: true })).toHaveCount(0);
  const clientRow = main.getByRole("row").filter({ hasText: clientName });
  await expect(clientRow.getByRole("cell", { name: "Dana Ruiz", exact: true })).toBeVisible();
  await expect(clientRow.getByRole("cell", { name: "1", exact: true })).toBeVisible();
  await expect(clientRow.getByRole("link", { name: jobName, exact: true })).toHaveAttribute(
    "href",
    `/app/jobs/${job2}`,
  );
  // Clients has the All chip only (answer 1): nothing to add.
  const clientChips = main.getByRole("navigation", { name: "Show clients", exact: true });
  await expect(clientChips.getByRole("link")).toHaveText(["All"]);
  await expect(main.getByRole("button", { name: "Add filter", exact: true })).toHaveCount(0);

  // 4. Families waits for parent accounts.
  await tabs.getByRole("link", { name: "Families", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/families$/);
  await expect(
    main.getByRole("heading", { name: "Families is coming soon", level: 2, exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("button", { name: /^New / })).toHaveCount(0);

  // 5. Contacts: the client's contact person is its main contact, marked "Main" in words.
  await tabs.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/contacts$/);
  for (const name of ["Name", "Role", "Client", "Email"])
    await expect(main.getByRole("columnheader", { name, exact: true })).toBeVisible();
  const row = (name: string) =>
    main
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .filter({ hasText: clientName });
  await expect(row("Dana Ruiz").getByText("Main", { exact: true })).toBeVisible();

  // A new contact, made main: they take over from Dana, here and on the client.
  await main.getByRole("button", { name: "New contact", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add contact" });
  await add.getByRole("combobox", { name: "Client", exact: true }).fill("Lincoln");
  await add
    .getByRole("listbox", { name: "Clients", exact: true })
    .getByRole("option", { name: new RegExp(clientName) })
    .click();
  await add.getByLabel("First name (optional)", { exact: true }).fill("Mark");
  await add.getByLabel("Last name (optional)", { exact: true }).fill("Ellis");
  await add.getByLabel("Role (optional)", { exact: true }).fill("Principal");
  await add.getByLabel("Email (optional)", { exact: true }).fill(`mark-${tag}@lincoln.example`);
  await add.getByLabel("Main contact for this client", { exact: true }).check();
  await add.getByRole("button", { name: "Add contact", exact: true }).click();
  await expect(add).toBeHidden();
  await expect(row("Mark Ellis").getByText("Main", { exact: true })).toBeVisible();
  await expect(row("Dana Ruiz")).toBeVisible();
  await expect(row("Dana Ruiz").getByText("Main", { exact: true })).toHaveCount(0);
  await expect(
    row("Mark Ellis").getByRole("cell", { name: "Principal", exact: true }),
  ).toBeVisible();
  const client = (await (await page.request.get(`/api/v1/clients/${clientId}`)).json()).client;
  expect([client.contactFirstName, client.contactLastName]).toEqual(["Mark", "Ellis"]);

  // Clients' row shows the new main contact, with their role.
  await tabs.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/clients$/);
  await expect(
    clientRow.getByRole("cell", { name: "Mark Ellis · Principal", exact: true }),
  ).toBeVisible();
  await tabs.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/contacts$/);

  // The Main contacts chip, in the address as a word.
  const contactChips = main.getByRole("navigation", { name: "Show contacts", exact: true });
  await contactChips.getByRole("link", { name: "Main contacts", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/contacts\?show=main$/);
  await expect(row("Mark Ellis")).toBeVisible();
  await expect(row("Dana Ruiz")).toHaveCount(0);

  // + Add filter › Client… adds the client as a chip of the owner's own: it opens at once (?client=<id>, an id only),
  // stays after a reload, and its own remove button takes it away (back to All).
  await contactChips.getByRole("link", { name: "All", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/contacts$/);
  await main.getByRole("button", { name: "Add filter", exact: true }).click();
  await main.getByRole("button", { name: "Client…", exact: true }).click();
  await main.getByRole("combobox", { name: "Client", exact: true }).fill("Lincoln");
  await main
    .getByRole("listbox", { name: "Clients", exact: true })
    .getByRole("option", { name: clientName })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/people/contacts\\?client=${clientId}$`));
  await expect(contactChips.getByRole("link", { name: clientName, exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(row("Mark Ellis")).toBeVisible();
  await page.reload();
  await expect(contactChips.getByRole("link", { name: clientName, exact: true })).toBeVisible();
  await expect(row("Dana Ruiz")).toBeVisible();
  await main.getByRole("button", { name: `Remove filter: ${clientName}`, exact: true }).click();
  await expect(contactChips.getByRole("link", { name: clientName, exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/people\/contacts$/);

  // The main contact's box is locked: the main contact changes by making someone else main.
  await row("Mark Ellis").getByRole("button", { name: "Mark Ellis", exact: true }).click();
  const markDialog = page.getByRole("dialog", { name: "Edit contact" });
  const markMain = markDialog.getByLabel("Main contact for this client", { exact: true });
  await expect(markMain).toBeChecked();
  await expect(markMain).toBeDisabled();
  await expect(
    markDialog.getByText("To change the main contact, make someone else main.", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(markDialog).toBeHidden();

  // Dana opens in the Edit dialog and is made main again (PATCH): she and Mark swap, on the client too.
  await row("Dana Ruiz").getByRole("button", { name: "Dana Ruiz", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit contact" });
  await expect(edit.getByLabel("First name (optional)", { exact: true })).toHaveValue("Dana");
  await edit.getByLabel("Main contact for this client", { exact: true }).check();
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(row("Dana Ruiz").getByText("Main", { exact: true })).toBeVisible();
  await expect(row("Mark Ellis").getByText("Main", { exact: true })).toHaveCount(0);
  const swapped = (await (await page.request.get(`/api/v1/clients/${clientId}`)).json()).client;
  expect([swapped.contactFirstName, swapped.contactLastName]).toEqual(["Dana", "Ruiz"]);

  // 6. Subjects: both children, across the two jobs, with Ordered for the owner.
  await tabs.getByRole("link", { name: "Subjects", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/subjects$/);
  await expect(main.getByText("Everyone across all your jobs", { exact: true })).toBeVisible();
  await expect(main.getByText("2 subjects across 2 jobs", { exact: true })).toBeVisible();
  for (const name of ["Name", "Class", "Job", "Ordered"])
    await expect(main.getByRole("columnheader", { name, exact: true })).toBeVisible();
  const subject = (name: string) =>
    main.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(
    subject("Ava Patel").getByRole("cell", { name: "Ordered", exact: true }),
  ).toBeVisible();
  await expect(
    subject("Ben Ortiz").getByRole("cell", { name: "Not ordered", exact: true }),
  ).toBeVisible();
  await expect(
    subject("Ben Ortiz").getByRole("link", { name: jobName, exact: true }),
  ).toBeVisible();
  await expect(
    subject("Ava Patel").getByRole("link", { name: `Fall Portraits ${tag}`, exact: true }),
  ).toHaveAttribute("href", `/app/jobs/${jobId}`);

  const subjectChips = main.getByRole("navigation", { name: "Show subjects", exact: true });
  await expect(subjectChips.getByRole("link")).toHaveText(["All", "Ordered", "Not ordered"]);
  await subjectChips.getByRole("link", { name: "Ordered", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/subjects\?show=ordered$/);
  await expect(subject("Ava Patel")).toBeVisible();
  await expect(subject("Ben Ortiz")).toHaveCount(0);
  await expect(main.getByText("1 subject across 1 job", { exact: true })).toBeVisible();
  await subjectChips.getByRole("link", { name: "Not ordered", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/subjects\?show=notOrdered$/);
  await expect(subject("Ben Ortiz")).toBeVisible();
  await expect(subject("Ava Patel")).toHaveCount(0);

  // + Add filter › Job… adds the job as a chip of the owner's own (?job=<id>): kept after a reload, then removed.
  await subjectChips.getByRole("link", { name: "All", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/subjects$/);
  await main.getByRole("button", { name: "Add filter", exact: true }).click();
  await main.getByRole("button", { name: "Job…", exact: true }).click();
  await main.getByRole("combobox", { name: "Job", exact: true }).fill("Spring");
  await main
    .getByRole("listbox", { name: "Jobs", exact: true })
    .getByRole("option", { name: jobName })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/people/subjects\\?job=${job2}$`));
  await expect(subjectChips.getByRole("link", { name: jobName, exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(subject("Ben Ortiz")).toBeVisible();
  await expect(subject("Ava Patel")).toHaveCount(0);
  await page.reload();
  await expect(subjectChips.getByRole("link", { name: jobName, exact: true })).toBeVisible();
  await expect(subject("Ben Ortiz")).toBeVisible();
  await expect(subject("Ava Patel")).toHaveCount(0);
  await main.getByRole("button", { name: `Remove filter: ${jobName}`, exact: true }).click();
  await expect(subjectChips.getByRole("link", { name: jobName, exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/people\/subjects$/);
  await expect(subject("Ava Patel")).toBeVisible();

  // The search finds a name without putting it in the address (D113).
  await main.getByRole("button", { name: "Search subjects", exact: true }).click();
  await main.getByRole("searchbox", { name: "Search subjects", exact: true }).fill("ben");
  await expect(subject("Ava Patel")).toHaveCount(0);
  await expect(subject("Ben Ortiz")).toBeVisible();
  expect(page.url()).not.toContain("ben");

  // A row opens the child on their job's Subjects tab.
  await subject("Ben Ortiz").getByRole("link", { name: "Ben Ortiz", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job2}/people\\?child=[0-9a-f-]{36}$`));

  // 7. A photographer: no Families tab, no Ordered column or chips, the contact dialog read-only; Families' address
  // takes them to Clients.
  const photographer = await joinAs(
    page,
    browser,
    `people-photo-${tag}@example.test`,
    "photographer",
  );
  const photoMain = photographer.getByRole("main");
  await photographer.goto("/app/people/subjects");
  await expect(
    photoMain.getByRole("navigation", { name: "People sections", exact: true }).getByRole("link"),
  ).toHaveText(["Clients", "Contacts", "Subjects"]);
  await expect(photoMain.getByText("2 subjects across 2 jobs", { exact: true })).toBeVisible();
  await expect(photoMain.getByRole("columnheader", { name: "Ordered", exact: true })).toHaveCount(
    0,
  );
  await expect(
    photoMain.getByRole("navigation", { name: "Show subjects", exact: true }).getByRole("link"),
  ).toHaveText(["All"]);
  const subjects = (await (await photographer.request.get("/api/v1/subjects")).json()).subjects as {
    hasPaidOrder: boolean | null;
  }[];
  expect(subjects.map((s) => s.hasPaidOrder)).toEqual([null, null]);
  expect((await photographer.request.get("/api/v1/subjects?show=ordered")).status()).toBe(403);
  await photographer.goto("/app/people/contacts");
  await expect(photoMain.getByRole("button", { name: "New contact", exact: true })).toHaveCount(0);
  await photoMain
    .getByRole("row")
    .filter({ hasText: clientName })
    .getByRole("button", { name: "Dana Ruiz", exact: true })
    .click();
  const view = photographer.getByRole("dialog", { name: "Contact", exact: true });
  await expect(view.getByLabel("First name (optional)", { exact: true })).toHaveValue("Dana");
  await expect(view.getByLabel("First name (optional)", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(view.getByLabel("Main contact for this client", { exact: true })).toBeDisabled();
  await expect(view.getByText("Owners and admins change contacts.", { exact: true })).toBeVisible();
  await expect(view.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await photographer.keyboard.press("Escape");
  await photographer.goto("/app/people/families");
  await expect(photographer).toHaveURL(/\/app\/people\/clients$/);
  await photographer.context().close();
  await context.close();
});
