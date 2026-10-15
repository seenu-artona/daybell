import { expect, test } from "@playwright/test";
import { joinAs, signUpOwner } from "./helpers";

// UI round 5 (D151, D152, D154; ADR 0029): Settings' sections on the left with Templates; the seeded default template
// ("Standard", today's behaviour); a new template whose Steps cards open their dialogs (QR cards ready 5 days before,
// shop closes 10 days after opening); Make default; the New job dialog choosing it, with its sentence; the job's
// Overview: Details names the template, Progress plans the cards' day, a rule changed for this job says so and Undo
// puts it back; a photographer reads templates but changes nothing; another studio can't see them. Desktop only (D136).
const run = `${Date.now()}`;

test("job templates: Settings, a template's steps, a new job from it, and its changes on the Overview", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Template Studio ${tag}`,
    slug: `tpl-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `tpl-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");
  const template = `School Fall ${tag}`;

  // 1. Settings: sections on the left (Team, Stripe, Taxes, Templates), the current one marked; Templates groups Jobs,
  // Messages and Print, with the seeded default.
  await page.goto("/app/settings/templates");
  const sections = main.getByRole("navigation", { name: "Settings sections", exact: true });
  await expect(sections.getByRole("link")).toHaveText(["Team", "Stripe", "Taxes", "Templates"]);
  await expect(sections.getByRole("link", { name: "Templates", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Jobs", "Messages", "Print"]);
  const standard = main.getByRole("link", { name: /^Standard/ });
  await expect(standard).toContainText("Default");
  await expect(standard).toContainText("Not used yet");
  await expect(main.getByText("Message templates are coming soon.", { exact: true })).toBeVisible();

  // 2. New template: the green button in the title row opens the name dialog; it lands on the template's page.
  await main.getByRole("link", { name: "New template", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New template", exact: true });
  await create.getByLabel("Name", { exact: true }).fill(template);
  await create.getByRole("button", { name: "Create template", exact: true }).click();
  await expect(main.getByRole("heading", { name: template, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/settings\/templates\/[0-9a-f-]{36}$/);
  const templateUrl = page.url();
  const templateId = templateUrl.split("/").pop() as string;
  const tsections = main.getByRole("navigation", { name: "Template sections", exact: true });
  await expect(tsections.getByRole("link")).toHaveText([
    "Steps",
    "Shop",
    "Messages",
    "Subjects and photos",
  ]);
  // Steps, grouped by stage; Makeup day and Archive are coming (Soon).
  await expect(main.getByRole("heading", { level: 2 })).toHaveText([
    "Prepare",
    "Picture day",
    "Selling",
    "Wrap-up",
  ]);
  await expect(main.getByText("Makeup day", { exact: true })).toBeVisible();
  const qr = main.getByRole("button", { name: /^QR cards ready/ });
  await expect(qr).toContainText("No day planned");
  await qr.click();
  const qrDialog = page.getByRole("dialog", { name: "QR cards ready", exact: true });
  await qrDialog.getByLabel("Days before picture day", { exact: true }).check();
  await qrDialog.getByLabel("Days", { exact: true }).fill("5");
  await qrDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(qrDialog).toBeHidden();
  await expect(qr).toContainText("5 days before picture day");
  const closes = main.getByRole("button", { name: /^Shop closes/ });
  await expect(closes).toContainText("When you close it");
  await closes.click();
  const closesDialog = page.getByRole("dialog", { name: "Shop closes", exact: true });
  await closesDialog.getByLabel("Days after the shop opens", { exact: true }).check();
  await closesDialog.getByLabel("Days", { exact: true }).fill("0");
  await closesDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(closesDialog.getByText("Enter a whole number from 1 to 365.")).toBeVisible();
  await closesDialog.getByLabel("Days", { exact: true }).fill("10");
  await closesDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(closes).toContainText("10 days after opening");
  // The name is edited in place.
  await main.getByRole("button", { name: "Rename template", exact: true }).click();
  await main.getByLabel("Template name", { exact: true }).fill(`${template} 2026`);
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await expect(main.getByRole("heading", { name: `${template} 2026`, level: 1 })).toBeFocused();
  // Make default (⋯ More), said in words; Default shows by the name.
  await main.getByRole("button", { name: "More actions", exact: true }).click();
  await main.getByRole("button", { name: "Make default", exact: true }).click();
  await expect(
    main.getByText(`${template} 2026 is now the default.`, { exact: true }),
  ).toBeVisible();
  await expect(main.getByText("Default", { exact: true })).toBeVisible();

  // Subjects and photos: what new jobs call the roster's class field (Seenu, ADR 0030 call 29), "Class" until changed.
  await tsections.getByRole("link", { name: "Subjects and photos", exact: true }).click();
  const classLabel = main.getByRole("textbox", { name: "Class field's name", exact: true });
  await expect(classLabel).toHaveValue("Class");
  await classLabel.fill("");
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await expect(main.getByText("Use 1 to 30 characters.", { exact: true })).toBeVisible();
  await classLabel.fill("Homeroom");
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();

  // 3. New job: the dialog has Name, Client, Picture day and Template, the new default chosen, with its sentence.
  await page.goto("/app/jobs");
  await main.getByRole("button", { name: "Create your first job", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create job" });
  await expect(dialog.getByLabel("Template", { exact: true })).toHaveValue(templateId);
  await expect(
    dialog.getByText(
      `${template} 2026 opens the shop when photos are checked and closes it 10 days later. You can change anything on the job.`,
      { exact: true },
    ),
  ).toBeVisible();
  await dialog.getByLabel("Job name").fill(`Lincoln ${tag}`);
  await dialog.getByLabel("Picture day").fill("2030-05-10");
  await dialog.getByRole("button", { name: "Create job", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
  const jobUrl = page.url();

  // 4. The Overview: Details names the template (no changes yet); Progress plans the cards for 5 days before picture
  // day and says the shop closes 10 days after it opens.
  const details = main.getByRole("complementary", { name: "Details", exact: true });
  await expect(details.getByRole("link", { name: `${template} 2026` })).toHaveAttribute(
    "href",
    `/app/settings/templates/${templateId}`,
  );
  await expect(details.getByText(/changes? for this job/)).toHaveCount(0);
  const progress = main.getByRole("region", { name: "Progress", exact: true });
  const step = (name: RegExp) => progress.getByRole("listitem").filter({ hasText: name });
  await expect(step(/^Next: Print QR cards/)).toContainText("Planned May 5, 2030");
  await expect(step(/^Automatic: Shop closes/)).toContainText("10 days after the shop opens");

  // 5. A rule changed for this job: the step says so, Details counts it, and Undo puts the template's rule back.
  await step(/^Automatic: Shop closes/)
    .getByRole("button", { name: "Change Shop closes", exact: true })
    .click();
  const jobRule = page.getByRole("dialog", { name: "Shop closes", exact: true });
  await expect(
    jobRule.getByText("Changes this job only. Its template stays as it is."),
  ).toBeVisible();
  await jobRule.getByLabel("Days", { exact: true }).fill("14");
  await jobRule.getByRole("button", { name: "Save", exact: true }).click();
  await expect(jobRule).toBeHidden();
  await expect(step(/^Automatic: Shop closes/)).toContainText("14 days after the shop opens");
  await expect(step(/^Automatic: Shop closes/)).toContainText("Changed for this job");
  await expect(details.getByText("1 change for this job", { exact: true })).toBeVisible();
  await step(/^Automatic: Shop closes/)
    .getByRole("button", { name: /^Undo/ })
    .click();
  await expect(step(/^Automatic: Shop closes/)).toContainText("10 days after the shop opens");
  await expect(step(/^Automatic: Shop closes/)).not.toContainText("Changed for this job");
  await expect(details.getByText(/changes? for this job/)).toHaveCount(0);

  // 5b. A draft can hold a closing date (ADR 0021): Change date on Shop closes sets one, and the step shows the date
  // instead of the rule (review fix H1).
  await step(/^Automatic: Shop closes/)
    .getByRole("button", { name: "Change date", exact: true })
    .click();
  const closing = page.getByRole("dialog", { name: "Closing date", exact: true });
  const inTwentyDays = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await closing.getByLabel("Last day to order", { exact: true }).fill(inTwentyDays);
  await closing.getByRole("button", { name: "Save closing date", exact: true }).click();
  await expect(closing).toBeHidden();
  await expect(step(/^Next: Shop closes/)).toContainText(/in (19|20) days/);
  await expect(step(/^Next: Shop closes/)).not.toContainText("after the shop opens");

  // 5b. The job calls the class field Homeroom, as its template said: Subjects' add form asks for a Homeroom.
  const jobId = jobUrl.split("/").pop() as string;
  expect((await (await page.request.get(`/api/v1/jobs/${jobId}`)).json()).job.classLabel).toBe(
    "Homeroom",
  );
  await page.goto(`${jobUrl}/people`);
  await main.getByRole("button", { name: "Add subjects", exact: true }).click();
  await main.getByRole("button", { name: "Add one by one", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Add child" })
      .getByRole("combobox", { name: "Homeroom (optional)", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // 6. The template counts the job; template changes reach new jobs only.
  await page.goto(templateUrl);
  await expect(main.getByText("Used by 1 job", { exact: true })).toBeVisible();

  // 7. A photographer reads templates but changes nothing: no New template, no ⋯, the cards aren't buttons.
  const photographer = await joinAs(page, browser, `tpl-photo-${tag}@example.test`, "photographer");
  await photographer.goto("/app/settings/templates");
  const photoMain = photographer.getByRole("main");
  await expect(
    photoMain.getByRole("navigation", { name: "Settings sections" }).getByRole("link"),
  ).toHaveText(["Team", "Templates"]);
  await expect(photoMain.getByRole("link", { name: "New template", exact: true })).toHaveCount(0);
  await photographer.goto(templateUrl);
  await expect(photoMain.getByText("Only owners and admins change templates.")).toBeVisible();
  await expect(photoMain.getByRole("button", { name: /^QR cards ready/ })).toHaveCount(0);
  await expect(photoMain.getByRole("button", { name: "More actions", exact: true })).toHaveCount(0);
  expect(
    (
      await photographer.request.patch(`/api/v1/job-templates/${templateId}`, {
        data: { name: "Mine" },
      })
    ).status(),
  ).toBe(403);

  // 8. Another studio sees none of it.
  const outsiderTab = await (await browser.newContext()).newPage();
  const outsider = await signUpOwner(outsiderTab, {
    studio: `Other Template Studio ${tag}`,
    slug: `tpl-other-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `tpl-other-${tag}@example.test`,
  });
  expect((await outsider.request.get(`/api/v1/job-templates/${templateId}`)).status()).toBe(404);
  const theirs = (await (await outsider.request.get("/api/v1/job-templates")).json()).templates as {
    id: string;
  }[];
  expect(theirs.map((t) => t.id)).not.toContain(templateId);
  expect(
    (
      await outsider.request.post("/api/v1/jobs", {
        data: { name: "Sneaky", type: "school", pictureDay: "2030-05-10", templateId },
      })
    ).status(),
  ).toBe(400);
});
