import { expect, type Locator, type Page, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 1 "Jobs and clients" (ADR 0008–0010): an owner adds a client in Contacts, creates a job in the
// one-form dialog picking that client in the combobox, then creates a second job adding a new client from the
// combobox's last option.
// The CI database is Canadian (D122), so address labels read Province / Postal code.
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
  // The phone header and the desktop top bar both exist; look inside the page's main area only.
  const main = page.getByRole("main");

  // 1. Contacts opens on Clients. Add a client; Quebec is refused (D131).
  await page.goto("/app/contacts");
  await expect(page).toHaveURL(/\/app\/contacts\/clients$/);
  // The tab reads "Children" followed by a "Soon" badge.
  await expect(main.getByText(/^Children/)).toBeVisible();
  await main.getByRole("button", { name: "Add client", exact: true }).click();
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

  // The job page: details, the D75 progress steps, and sections still to come.
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { name: job, level: 1 })).toBeVisible();
  await expect(main.getByText("Draft", { exact: true })).toBeVisible();
  await expect(main.getByText(`${client} · Toronto`, { exact: true })).toBeVisible();
  await expect(main.getByText("JOB00001", { exact: true })).toBeVisible();
  await expect(main.getByText("120", { exact: true })).toBeVisible();
  for (const stage of ["Picture day", "Tagged", "Shop live", "Shipped"]) {
    await expect(main.getByRole("listitem").filter({ hasText: stage })).toContainText("Upcoming");
  }

  // Editing uses the same form.
  await main.getByRole("button", { name: "Edit job" }).click();
  const edit = page.getByRole("dialog", { name: "Edit job" });
  await edit.getByLabel("Job name").fill(`${job} (edited)`);
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(main.getByRole("heading", { name: `${job} (edited)`, level: 1 })).toBeVisible();

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

  // The Jobs list shows both as drafts with their numbers.
  await page.goto("/app/jobs");
  const first = main.getByRole("row").filter({ hasText: `${job} (edited)` });
  await expect(first).toContainText(client);
  await expect(first).toContainText("JOB00001");
  await expect(first).toContainText("Draft");
  await expect(main.getByRole("row").filter({ hasText: newClient })).toContainText("JOB00002");

  // Home's "Create job" link opens the same dialog.
  await page.goto("/app/jobs?new=1");
  await expect(page.getByRole("dialog", { name: "Create job" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The activity log names jobs and clients by looking them up, never from the event (D96).
  await page.goto("/app");
  await expect(main.getByText(`${owner} created the job ${job} (edited)`)).toBeVisible();
  await expect(main.getByText(`${owner} added the client ${client}`)).toBeVisible();

  // The API refuses changing a job's status directly, Quebec clients, and duplicate job numbers.
  const jobs = await (await page.request.get("/api/v1/jobs")).json();
  const id = jobs.jobs[0].id as string;
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
