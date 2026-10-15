import { readFileSync } from "node:fs";
import { type APIResponse, expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 3 "QR cards" (D32, D138, D140, D143; Seenu's answers of Oct 11 2026; ADR 0015, 0017): the checklist
// task that ticks itself, the API's
// PDF (four cards per double-sided sheet: a front page and a back page; no card for Do not photograph, blank cards, the
// same card on every reprint, never cached),
// People's Print QR cards dialog, one card from the person's record (D153), the job's History (D151), and that another studio can't
// print or count the job's cards. Desktop only (D136). PDFs are checked by their page objects; the cards' text is
// embedded-font glyphs, so names and codes can't be read from the bytes.
const run = `${Date.now()}`;

/** Page objects in a PDF ("/Type /Page", not "/Type /Pages"); pdfkit never hides them in object streams. */
function pagesIn(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;
}
async function pdfPages(res: APIResponse): Promise<number> {
  return pagesIn(await res.body());
}

test("QR cards: print from the API and from People, with the checklist task", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${info.project.name}-${run}`;
  const owner = `qr-owner-${tag}@example.test`;
  const page = await signUpOwner(firstTab, {
    studio: `QR Studio ${tag}`,
    slug: `qr-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: owner,
  });
  const main = page.getByRole("main");

  // A job with a class "4B" (two children), one child without a class, one in "5A", and one marked Do not photograph.
  const jobName = `QR School ${tag}`;
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: jobName, type: "school", pictureDay: "2030-05-01" },
  });
  expect(created.status()).toBe(201);
  const job = (await created.json()).job as { id: string; internalNumber: string };
  const cardsPath = `/api/v1/jobs/${job.id}/qr-cards`;
  const groupId = async (name: string) => {
    const res = await page.request.post(`/api/v1/jobs/${job.id}/groups`, { data: { name } });
    expect(res.status()).toBe(201);
    return (await res.json()).group.id as string;
  };
  const g4b = await groupId("4B");
  const g5a = await groupId("5A");
  const addChild = async (data: Record<string, unknown>) => {
    const res = await page.request.post(`/api/v1/jobs/${job.id}/children`, { data });
    expect(res.status()).toBe(201);
    return (await res.json()).child.id as string;
  };
  await addChild({ firstName: "Maya", lastName: "Johnson", groupId: g4b });
  await addChild({ firstName: "Liam", lastName: "Chen", groupId: g4b });
  await addChild({ firstName: "Ava", lastName: "Patel", groupId: g5a });
  await addChild({ firstName: "Noah", lastName: "Garcia" });
  const dnp = await addChild({
    firstName: "Zoe",
    lastName: "Optout",
    groupId: g4b,
    doNotPhotograph: true,
  });

  // 1. Overview (D152): Print QR cards is the step to do now, and its action opens Subjects' print dialog.
  await page.goto(`/app/jobs/${job.id}`);
  const progress = main.getByRole("region", { name: "Progress", exact: true });
  const qrTodo = progress.getByRole("listitem").filter({ hasText: /^Now: Print QR cards/ });
  await expect(qrTodo.getByRole("link", { name: "Print QR cards" })).toHaveAttribute(
    "href",
    `/app/jobs/${job.id}/people?print=qr`,
  );

  // 2. The API: the whole job is 4 cards (never the Do not photograph child) on one sheet (a front page and a back
  // page), never cached.
  const whole = await page.request.post(cardsPath, { data: {} });
  expect(whole.status()).toBe(200);
  expect(whole.headers()["content-type"]).toBe("application/pdf");
  expect(whole.headers()["cache-control"]).toBe("no-store");
  expect(whole.headers()["content-disposition"]).toBe(
    `attachment; filename="qr-cards-${job.internalNumber}.pdf"`,
  );
  expect(whole.headers()["daybell-cards"]).toBe("4");
  expect(whole.headers()["daybell-cards-skipped"]).toBe("0");
  expect(await pdfPages(whole)).toBe(2);
  // One blank card makes a fifth card and a second sheet.
  const withBlank = await page.request.post(cardsPath, { data: { blankCards: 1 } });
  expect(withBlank.headers()["daybell-cards"]).toBe("5");
  expect(await pdfPages(withBlank)).toBe(4);
  // Chosen classes and "no class"; one child; refusals.
  const chosen = await page.request.post(cardsPath, { data: { groupIds: [g4b, "none"] } });
  expect(chosen.headers()["daybell-cards"]).toBe("3");
  const single = await page.request.post(cardsPath, { data: { childId: dnp } });
  expect(single.status()).toBe(409);
  expect((await page.request.post(cardsPath, { data: { blankCards: 101 } })).status()).toBe(400);
  expect(
    (await page.request.post(cardsPath, { data: { groupIds: [crypto.randomUUID()] } })).status(),
  ).toBe(400);
  // Every child keeps one card: four cards for four children, and the one blank card made above.
  const status = await page.request.get(cardsPath);
  expect(await status.json()).toEqual({ qrCards: { eligible: 4, withCard: 4, blankCards: 1 } });

  // 3. Overview: the step is done, so Prepare is finished and folds to one line; opened, it says when and who printed
  // them, with a quiet Print again. The print is in More › History.
  await page.reload();
  // The header line, not the step to do now (whose screen-reader word also reads "Now:").
  await expect(progress.locator("[data-progress-now]")).toHaveText("Now: Picture day");
  await progress.getByRole("button", { name: /^Prepare\s*Done/ }).click();
  const qrDone = progress.getByRole("listitem").filter({ hasText: /^Done: QR cards printed/ });
  await expect(qrDone).toContainText(owner);
  await expect(qrDone.getByRole("link", { name: "Print again" })).toHaveAttribute(
    "href",
    `/app/jobs/${job.id}/people?print=qr`,
  );
  await main.getByRole("button", { name: "More actions", exact: true }).click();
  await main.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "History", exact: true });
  await expect(
    history.getByText(`${owner} printed QR cards for ${jobName}`, { exact: true }).first(),
  ).toBeVisible();
  await history.getByRole("button", { name: "Close", exact: true }).first().click();

  // 4. A subject added later reopens the step (back to Prepare); its action opens Subjects' print dialog.
  await addChild({ firstName: "Late", lastName: "Comer", groupId: g5a });
  await page.reload();
  // The header line, not the step to do now (whose screen-reader word also reads "Now:").
  await expect(progress.locator("[data-progress-now]")).toHaveText("Now: Prepare");
  await qrTodo.getByRole("link", { name: "Print QR cards" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.id}/people$`));
  const dialog = page.getByRole("dialog", { name: "Print QR cards" });
  await expect(dialog).toBeVisible();

  // 5. The dialog: choose a class, add blank cards, download the PDF.
  await dialog.getByLabel("Choose classes", { exact: true }).check();
  await dialog.getByLabel("5A (2 cards)", { exact: true }).check();
  await dialog.getByLabel("Blank cards", { exact: true }).fill("3");
  await expect(dialog.getByText("5 cards on 2 sheets of US Letter", { exact: true })).toBeVisible();
  // How to print them, next to the button and read with it.
  const duplex = dialog.getByText("Print double-sided, flip on long edge", { exact: true });
  await expect(duplex).toBeVisible();
  const check = "Check the name on the back matches the front before handing cards out.";
  await expect(dialog.getByText(check, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Download PDF", exact: true }),
  ).toHaveAccessibleDescription(`Print double-sided, flip on long edge ${check}`);
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download PDF", exact: true }).click(),
  ]);
  expect(file.suggestedFilename()).toBe(`qr-cards-${job.internalNumber}.pdf`);
  expect(pagesIn(readFileSync(await file.path()))).toBe(4);
  await expect(dialog.getByRole("status")).toContainText("Downloaded 5 cards.");
  // Out-of-range blank cards are caught before anything is sent.
  await dialog.getByLabel("Blank cards", { exact: true }).fill("101");
  await dialog.getByRole("button", { name: "Download PDF", exact: true }).click();
  await expect(
    dialog.getByText("Enter a whole number of blank cards from 0 to 100.", { exact: true }),
  ).toBeVisible();
  // The footer's Close (the header's X is also named Close, outside the form).
  await dialog.locator("form").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();

  // 6. One person's card from their record (D153: the list folds beside it); someone marked Do not photograph has none.
  await main.getByRole("link", { name: "Maya Johnson", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Maya Johnson", level: 2 })).toBeFocused();
  const mayaCard = main.getByRole("region", { name: "QR card", exact: true });
  const [one] = await Promise.all([
    page.waitForEvent("download"),
    mayaCard.getByRole("button", { name: "Print again", exact: true }).click(),
  ]);
  expect(one.suggestedFilename()).toBe(`qr-cards-${job.internalNumber}.pdf`);
  // One card: its front and its back.
  expect(pagesIn(readFileSync(await one.path()))).toBe(2);
  await expect(main.getByText("Downloaded the QR card.", { exact: true })).toBeVisible();
  await expect(mayaCard.getByText("Printed", { exact: true })).toBeVisible();
  await main.getByRole("link", { name: "Zoe Optout", exact: true }).click();
  const zoeCard = main.getByRole("region", { name: "QR card", exact: true });
  await expect(
    zoeCard.getByText("No QR card: marked Do not photograph.", { exact: true }),
  ).toBeVisible();
  await expect(zoeCard.getByRole("button")).toHaveCount(0);

  // 7. Another studio can neither print the job's cards nor count them.
  const outsiderTab = await (await browser.newContext()).newPage();
  const outsider = await signUpOwner(outsiderTab, {
    studio: `Other QR Studio ${tag}`,
    slug: `qr-other-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `qr-other-${tag}@example.test`,
  });
  expect((await outsider.request.post(cardsPath, { data: {} })).status()).toBe(404);
  expect((await outsider.request.get(cardsPath)).status()).toBe(404);
});
