import { expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 1 "Jobs and organizations": an owner creates a job with a new organization through the wizard, sees it
// in Jobs as a draft, opens it, finds the organization under Contacts, and sees it in the activity log.
// The CI database is Canadian (D122), so address labels read Province / Postal code.
const run = `${Date.now()}`;

test("owner creates a job with a new organization", async ({ page: firstTab }, info) => {
  const tag = `${info.project.name}-${run}`;
  const owner = `jobs-owner-${tag}@example.test`;
  const organization = `Lincoln Elementary ${tag}`;
  const job = `Lincoln Fall ${tag}`;
  const page = await signUpOwner(firstTab, {
    studio: `Jobs Studio ${tag}`,
    slug: `jobs-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: owner,
  });
  // The phone header and the desktop top bar both exist; look inside the page's main area only.
  const main = page.getByRole("main");

  // Jobs is built now: an empty list invites the first job.
  await page.goto("/app/jobs");
  await expect(main.getByRole("heading", { name: "No jobs yet" })).toBeVisible();
  await main.getByRole("link", { name: "Create your first job" }).click();
  await expect(page).toHaveURL(/\/app\/jobs\/new$/);

  // 1. Type.
  await expect(main.getByRole("heading", { name: "What are you photographing?" })).toBeVisible();
  await main.getByText("Classes at a school").click();
  await main.getByRole("button", { name: "Next" }).click();

  // 2. Organization: none yet, so the new-organization form shows. Quebec is refused (D131).
  await expect(main.getByRole("heading", { name: "Who is it for?" })).toBeVisible();
  await main.getByLabel("Name", { exact: true }).fill(organization);
  await expect(main.getByLabel("Kind")).toHaveValue("school");
  await main.getByLabel(/^City/).fill("Toronto");
  await main.getByLabel(/^Province/).fill("QC");
  await expect(main.getByLabel("Country")).toHaveValue("CA");
  await main.getByRole("button", { name: "Next" }).click();
  await expect(main.getByText("Daybell isn't available in Quebec yet")).toBeVisible();
  await main.getByLabel(/^Province/).fill("ON");
  await main.getByLabel(/^Postal code/).fill("M5V 2T6");
  await main.getByRole("button", { name: "Next" }).click();

  // 3. Name and picture day.
  await expect(main.getByRole("heading", { name: "Name and picture day" })).toBeVisible();
  await main.getByLabel("Job name").fill(job);
  await main.getByLabel("Picture day").fill("2026-10-14");
  await main.getByRole("button", { name: "Create job" }).click();

  // The job page: details, the D75 progress steps, and sections still to come.
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { name: job, level: 1 })).toBeVisible();
  await expect(main.getByText("Draft", { exact: true })).toBeVisible();
  await expect(main.getByText(`${organization} · Toronto`)).toBeVisible();
  await expect(main.getByRole("heading", { name: "Job progress" })).toBeVisible();
  for (const stage of ["Picture day", "Tagged", "Shop live", "Shipped"]) {
    await expect(main.getByRole("listitem").filter({ hasText: stage })).toContainText("Upcoming");
  }
  await expect(main.getByRole("heading", { name: "Roster" })).toBeVisible();

  // Editing the job changes its name.
  await main.getByRole("button", { name: "Edit job" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit job" });
  await dialog.getByLabel("Job name").fill(`${job} (edited)`);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(main.getByRole("heading", { name: `${job} (edited)`, level: 1 })).toBeVisible();

  // The Jobs list shows it as a draft.
  await page.goto("/app/jobs");
  const row = main.getByRole("row").filter({ hasText: `${job} (edited)` });
  await expect(row).toContainText(organization);
  await expect(row).toContainText("Draft");

  // Contacts opens on Organizations, which lists the new organization.
  await page.goto("/app/contacts");
  await expect(page).toHaveURL(/\/app\/contacts\/organizations$/);
  await expect(main.getByRole("cell", { name: organization })).toBeVisible();
  await expect(main.getByText("Children")).toBeVisible();

  // The activity log names the job and organization by looking them up, never from the event (D96).
  await page.goto("/app");
  await expect(main.getByText(`${owner} created the job ${job} (edited)`)).toBeVisible();
  await expect(main.getByText(`${owner} added the organization ${organization}`)).toBeVisible();

  // The API refuses changing a job's status directly and Quebec addresses.
  const jobs = await (await page.request.get("/api/v1/jobs")).json();
  const id = jobs.jobs[0].id as string;
  const status = await page.request.patch(`/api/v1/jobs/${id}`, { data: { status: "selling" } });
  expect(status.status()).toBe(400);
  const quebec = await page.request.post("/api/v1/organizations", {
    data: { name: "École", kind: "school", region: "QC", country: "CA" },
  });
  expect(quebec.status()).toBe(400);
  expect((await quebec.json()).error.fields.region).toBe("validation.quebec");
});
