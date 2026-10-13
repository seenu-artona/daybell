import { type APIResponse, expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Phase 1 step 3 "QR cards" (D32, D138, D140, D143; Seenu's answers of Oct 11 2026; ADR 0015, 0017): the checklist
// task that ticks itself, the API's
// PDF (four cards per page, no card for Do not photograph, blank cards, the same card on every reprint, never cached),
// People's Print QR cards dialog, one card from the child panel, the job's activity, and that another studio can't
// print or count the job's cards. Desktop only (D136). PDFs are checked by their page objects; the cards' text is
// embedded-font glyphs, so names and codes can't be read from the bytes.
const run = `${Date.now()}`;

/** Page objects in a PDF ("/Type /Page", not "/Type /Pages"); pdfkit never hides them in object streams. */
async function pdfPages(res: APIResponse): Promise<number> {
  return (await res.body()).toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;
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

  // 1. Overview: Print QR cards is next, and its row links to People's print dialog.
  await page.goto(`/app/jobs/${job.id}`);
  const checklist = main.getByRole("region", { name: "Checklist", exact: true });
  const qrTodo = checklist.getByRole("listitem").filter({ hasText: "Print QR cards" });
  await expect(qrTodo).toContainText("Next");
  await expect(qrTodo.getByRole("link")).toHaveAttribute(
    "href",
    `/app/jobs/${job.id}/people?print=qr`,
  );

  // 2. The API: the whole job is 4 cards (never the Do not photograph child) on one page, never cached.
  const whole = await page.request.post(cardsPath, { data: {} });
  expect(whole.status()).toBe(200);
  expect(whole.headers()["content-type"]).toBe("application/pdf");
  expect(whole.headers()["cache-control"]).toBe("no-store");
  expect(whole.headers()["content-disposition"]).toBe(
    `attachment; filename="qr-cards-${job.internalNumber}.pdf"`,
  );
  expect(whole.headers()["daybell-cards"]).toBe("4");
  expect(whole.headers()["daybell-cards-skipped"]).toBe("0");
  expect(await pdfPages(whole)).toBe(1);
  // One blank card makes a fifth card and a second page.
  const withBlank = await page.request.post(cardsPath, { data: { blankCards: 1 } });
  expect(withBlank.headers()["daybell-cards"]).toBe("5");
  expect(await pdfPages(withBlank)).toBe(2);
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

  // 3. Overview: the task ticked itself; Set up is done and picture day is far, so the list is collapsed to the next
  // task (on track), and the print is in the job's Recent activity.
  await page.reload();
  await expect(checklist.getByText("3 of 7 done", { exact: true })).toBeVisible();
  await expect(checklist.getByText("Next: Picture day", { exact: true })).toBeVisible();
  await checklist.getByRole("button", { name: "Show all tasks", exact: true }).click();
  await expect(qrTodo).toContainText("Done");
  const recent = main.getByRole("region", { name: "Recent activity" });
  await expect(
    recent.getByText(`${owner} printed QR cards for ${jobName}`, { exact: true }).first(),
  ).toBeVisible();

  // 4. A child added later reopens the task (the list opens again: back in Set up); its row opens People's print
  // dialog.
  await addChild({ firstName: "Late", lastName: "Comer", groupId: g5a });
  await page.reload();
  await expect(qrTodo).toContainText("Next");
  await expect(qrTodo).toContainText("1 child without a card");
  await qrTodo.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.id}/people$`));
  const dialog = page.getByRole("dialog", { name: "Print QR cards" });
  await expect(dialog).toBeVisible();

  // 5. The dialog: choose a class, add blank cards, download the PDF.
  await dialog.getByLabel("Choose classes", { exact: true }).check();
  await dialog.getByLabel("5A (2 cards)", { exact: true }).check();
  await dialog.getByLabel("Blank cards", { exact: true }).fill("3");
  await expect(dialog.getByText("5 cards on 2 pages of US Letter", { exact: true })).toBeVisible();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download PDF", exact: true }).click(),
  ]);
  expect(file.suggestedFilename()).toBe(`qr-cards-${job.internalNumber}.pdf`);
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

  // 6. One child's card from the panel; a child marked Do not photograph has none.
  await main.getByRole("link", { name: "Maya Johnson", exact: true }).click();
  const maya = page.getByRole("complementary", { name: "Maya Johnson" });
  const [one] = await Promise.all([
    page.waitForEvent("download"),
    maya.getByRole("button", { name: "Print QR card", exact: true }).click(),
  ]);
  expect(one.suggestedFilename()).toBe(`qr-cards-${job.internalNumber}.pdf`);
  await expect(main.getByText("Downloaded the QR card.", { exact: true })).toBeVisible();
  await main.getByRole("link", { name: "Zoe Optout", exact: true }).click();
  const zoe = page.getByRole("complementary", { name: "Zoe Optout" });
  await expect(
    zoe.getByText("No QR card: marked Do not photograph", { exact: true }),
  ).toBeVisible();
  await expect(zoe.getByRole("button", { name: "Print QR card", exact: true })).toHaveCount(0);

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
