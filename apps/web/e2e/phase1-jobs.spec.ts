import { expect, type Locator, type Page, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 1 "Jobs and clients" (ADR 0008–0010): an owner adds a client in People › Clients (D150), creates a job
// in the one-form dialog picking that client in the combobox, then creates a second job adding a new client from the
// combobox's last option. Then the Jobs list (D147): its columns, the chips, a client chip added from "+ Add filter"
// (saved, kept after a reload, removed with its own button), the search, Calendar coming soon, and an old Contacts link
// to a client opening it in People. The CI database is Canadian (D122), so address labels read Province / Postal code.
const run = `${Date.now()}`;

/** Fills the client form inside `dialog`. */
async function fillClient(dialog: Locator, name: string | null, province: string) {
  if (name !== null) await dialog.getByLabel("Client name", { exact: true }).fill(name);
  await dialog.getByLabel(/^City/).fill("Toronto");
  await dialog.getByLabel(/^Province/).fill(province);
  await dialog.getByLabel(/^First name/).fill("Pat");
  await dialog.getByLabel(/^Email/).fill("pat@example.test");
}

/** The job dialog, opened from Jobs. "More options" starts closed, with the next number inside it. */
async function openJobDialog(page: Page, button: string): Promise<Locator> {
  await page.getByRole("main").getByRole("button", { name: button, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create job" });
  await expect(dialog.getByLabel("Internal job number")).toBeHidden();
  await dialog.getByText("More options", { exact: true }).click();
  await expect(dialog.getByLabel("Internal job number")).toHaveValue(/^JOB\d{5}$/);
  return dialog;
}

test("owner adds a client, then creates jobs in the job dialog", async ({
  page: firstTab,
}, info) => {
  const tag = `${info.project.name}-${run}`;
  const owner = `jobs-owner-${tag}@example.test`;
  const client = `Lincoln Elementary ${tag}`;
  const newClient = `Westview Soccer ${tag}`;
  const job = `Lincoln Fall ${tag}`;
  const page = await signUpOwner(firstTab, {
    studio: `Jobs Studio ${tag}`,
    slug: `jobs-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: owner,
  });
  // Look inside the page's main area (the menu has its own links and search).
  const main = page.getByRole("main");

  // 1. People opens on Clients (D150); the old Contacts address still lands there. Add a client with New client;
  // Quebec is refused (D131).
  await page.goto("/app/contacts");
  await expect(page).toHaveURL(/\/app\/people\/clients$/);
  await expect(main.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await main.getByRole("button", { name: "New client", exact: true }).click();
  const addClient = page.getByRole("dialog", { name: "Add client" });
  await fillClient(addClient, client, "QC");
  await expect(addClient.getByLabel("Country")).toHaveValue("CA");
  await addClient.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(addClient.getByText("Daybell isn't available in Quebec yet")).toBeVisible();
  await addClient.getByLabel(/^Province/).fill("ON");
  await addClient.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(addClient).toBeHidden();
  await expect(main.getByRole("cell", { name: client, exact: true })).toBeVisible();

  // 2. Jobs is empty; create the first job in the dialog, picking the client in the combobox.
  await page.goto("/app/jobs");
  await expect(main.getByRole("heading", { name: "No jobs yet" })).toBeVisible();
  let dialog = await openJobDialog(page, "Create your first job");
  await expect(dialog.getByLabel("Internal job number")).toHaveValue("JOB00001");
  await dialog.getByLabel("Job name").fill(job);
  await dialog.getByLabel("Picture day").fill("2026-10-14");
  await dialog.getByLabel("Job type").selectOption("school");
  let combobox = dialog.getByRole("combobox", { name: "Client (optional)" });
  // The combobox's own listbox, not the Job type <select> options.
  let clientList = dialog.getByRole("listbox", { name: "Clients" });
  await combobox.fill("Lincoln");
  await clientList.getByRole("option", { name: new RegExp(client) }).click();
  await expect(combobox).toHaveValue(client);
  await dialog.getByLabel(/^Subjects expected/).fill("120");
  await dialog.getByRole("button", { name: "Create job", exact: true }).click();

  // The job page (D137, D140, D143): title row with name, status and details; Overview with the checklist at Set up.
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { name: job, level: 1 })).toBeVisible();
  await expect(main.getByText("Draft", { exact: true })).toBeVisible();
  await expect(
    main.getByText(`School · ${client} · Oct 14, 2026 · JOB00001`, { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    main
      .getByRole("region", { name: "Checklist", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "Add the roster" }),
  ).toContainText("Next");
  // The shop's one pill: Start selling (owners and admins, while a draft), white since D144.
  await expect(main.getByRole("button", { name: "Start selling" })).toBeVisible();

  // Editing uses the same form, from More actions.
  await main.getByRole("button", { name: "More actions" }).click();
  await main.getByRole("button", { name: "Edit job" }).click();
  const edit = page.getByRole("dialog", { name: "Edit job" });
  await edit.getByLabel("Job name").fill(`${job} (edited)`);
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(main.getByRole("heading", { name: `${job} (edited)`, level: 1 })).toBeVisible();
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();

  // 3. A second job adds a new client from the combobox's last option. Escape closes only the top dialog.
  await page.goto("/app/jobs");
  dialog = await openJobDialog(page, "New job");
  await expect(dialog.getByLabel("Internal job number")).toHaveValue("JOB00002");
  await dialog.getByLabel("Job name").fill(`Westview Spring ${tag}`);
  await dialog.getByLabel("Picture day").fill("2027-04-02");
  await dialog.getByLabel("Job type").selectOption("sports");
  combobox = dialog.getByRole("combobox", { name: "Client (optional)" });
  clientList = dialog.getByRole("listbox", { name: "Clients" });
  await combobox.fill(newClient);
  // No client matches yet, so the list holds only "Add new client".
  await expect(clientList.getByRole("option")).toHaveCount(1);
  // Escape closes the list, not the dialog.
  await combobox.press("Escape");
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();
  await combobox.fill(newClient);
  await clientList.getByRole("option", { name: "Add new client" }).click();
  const nested = page.getByRole("dialog", { name: "Add client" });
  await expect(nested.getByLabel("Client name", { exact: true })).toHaveValue(newClient);
  await page.keyboard.press("Escape");
  await expect(nested).toBeHidden();
  await expect(dialog).toBeVisible();
  // Focus coming back from the client dialog doesn't reopen the list.
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await combobox.click();
  await clientList.getByRole("option", { name: "Add new client" }).click();
  await nested.getByLabel("Client name", { exact: true }).fill(newClient);
  await fillClient(nested, null, "ON");
  await nested.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(nested).toBeHidden();
  await expect(combobox).toHaveValue(newClient);
  await dialog.getByRole("button", { name: "Create job", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: `Westview Spring ${tag}`, level: 1 }),
  ).toBeVisible();

  // The Jobs list shows both as drafts, one line each: no job number under the name (D147; Seenu, Oct 14).
  await page.goto("/app/jobs");
  const first = main.getByRole("row").filter({ hasText: `${job} (edited)` });
  await expect(first).toContainText(client);
  await expect(first).not.toContainText("JOB00001");
  await expect(first).toContainText("Draft");
  // Columns (D147): job, client, picture day, status, and when the shop closes ("Not selling yet" for a draft).
  await expect(first).toContainText("Not selling yet");
  for (const name of ["Job", "Client", "Picture day", "Status", "Shop closes"])
    await expect(main.getByRole("columnheader", { name, exact: true })).toBeVisible();
  await expect(main.getByRole("row").filter({ hasText: newClient })).toBeVisible();

  // Chips (D147): All, Draft, Selling and Closed are links, one selected (aria-current) at a time.
  const chips = main.getByRole("navigation", { name: "Show jobs", exact: true });
  await expect(chips.getByRole("link", { name: "All", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await chips.getByRole("link", { name: "Selling", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?status=selling$/);
  await expect(main.getByText("No jobs match.", { exact: true })).toBeVisible();
  await chips.getByRole("link", { name: "Draft", exact: true }).click();
  await expect(first).toBeVisible();

  // + Add filter › Client… adds the client as a chip of the person's own: it opens at once (?client=<id>, an id only),
  // stays after a reload, and its own remove button takes it away (back to All).
  await main.getByRole("button", { name: "Add filter", exact: true }).click();
  await main.getByRole("button", { name: "Client…", exact: true }).click();
  const clientField = main.getByRole("combobox", { name: "Client", exact: true });
  await expect(clientField).toBeFocused();
  await clientField.fill(client);
  await main
    .getByRole("listbox", { name: "Clients" })
    .getByRole("option", { name: client })
    .click();
  await expect(page).toHaveURL(/\/app\/jobs\?client=[0-9a-f-]{36}$/);
  const clientId = new URL(page.url()).searchParams.get("client") as string;
  await expect(chips.getByRole("link", { name: client, exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(main.getByRole("row").filter({ hasText: newClient })).toHaveCount(0);
  await expect(first).toBeVisible();
  await page.reload();
  await expect(chips.getByRole("link", { name: client, exact: true })).toBeVisible();
  await main.getByRole("button", { name: `Remove filter: ${client}`, exact: true }).click();
  await expect(chips.getByRole("link", { name: client, exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/jobs$/);

  // The search finds a job by its name or number; its text never goes in the address (D113).
  await main.getByRole("button", { name: "Search jobs", exact: true }).click();
  await main.getByRole("searchbox", { name: "Search jobs", exact: true }).fill("JOB00002");
  await expect(main.getByRole("row").filter({ hasText: newClient })).toBeVisible();
  await expect(first).toHaveCount(0);
  expect(page.url()).not.toContain("JOB00002");

  // Calendar is its own section, coming soon.
  await main.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs\/calendar$/);
  await expect(
    main.getByRole("heading", { name: "Calendar is coming soon", level: 2, exact: true }),
  ).toBeVisible();

  // An old Contacts link to a client (a menu search result before D150) lands on People › Clients with it open.
  await page.goto(`/app/contacts/clients?client=${clientId}`);
  await expect(page).toHaveURL(/\/app\/people\/clients$/);
  const editClient = page.getByRole("dialog", { name: "Edit client" });
  await expect(editClient.getByLabel("Client name", { exact: true })).toHaveValue(client);

  // Home's "Create job" link opens the same dialog.
  await page.goto("/app/jobs?new=1");
  await expect(page.getByRole("dialog", { name: "Create job" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The activity log names jobs and clients by looking them up, never from the event (D96). Home has no feed (D146):
  // the job's own timeline is on its page, and the studio's log is in the API.
  const { activity } = await (await page.request.get("/api/v1/studio/activity")).json();
  const lines = (type: string) =>
    activity
      .filter(
        (a: { type: string; actorEmail: string }) => a.type === type && a.actorEmail === owner,
      )
      .map((a: { subjectName: string | null }) => a.subjectName);
  expect(lines("job.created")).toContain(`${job} (edited)`);
  expect(lines("client.created")).toContain(client);

  // The API refuses changing a job's status directly, Quebec clients, and duplicate job numbers.
  const jobs = await (await page.request.get("/api/v1/jobs")).json();
  const id = jobs.jobs[0].id as string;
  expect(jobs.jobs[0].checklist).toEqual({
    milestone: "setUp",
    done: 1,
    total: 7,
    next: "addRoster",
  });
  const status = await page.request.patch(`/api/v1/jobs/${id}`, { data: { status: "selling" } });
  expect(status.status()).toBe(400);
  const quebec = await page.request.post("/api/v1/clients", {
    data: { name: "École", region: "QC", country: "CA" },
  });
  expect(quebec.status()).toBe(400);
  expect((await quebec.json()).error.fields.region).toBe("validation.quebec");
  const duplicate = await page.request.patch(`/api/v1/jobs/${id}`, {
    data: { internalNumber: "job00001" },
  });
  expect(duplicate.status()).toBe(400);
  expect((await duplicate.json()).error.fields.internalNumber).toBe(
    "validation.internalNumberTaken",
  );
});
