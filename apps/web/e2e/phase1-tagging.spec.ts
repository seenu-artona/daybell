import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import QRCode from "qrcode";
import sharp, { type OverlayOptions } from "sharp";
import { signUpOwner } from "./helpers";

// Phase 1 step 5 "QR tagging and review" (D32, F16, D142 #7, D143; Seenu's answers of Oct 12 2026; ADR 0018), with
// STORAGE_DRIVER=local (the web server reads the cards, as the Lambda does): a batch of photos with QR cards (one
// before the first card, a card shot twice, a retake-free sequence, a damaged card, a blank card) is tagged; the
// review moves a Leftover with Move to… by keyboard, drags a photo, confirms flagged photos, names the blank card's
// child and marks tagging reviewed; the checklist ticks, a new upload reopens it; a class photo upload goes to its
// class; another studio sees and changes nothing. Desktop only (D136). JPEGs and QR codes are made in the test.
const run = `${Date.now()}`;

/**
 * A 24-megapixel photo with a plain background of its own (so no two files are the same), and maybe a card: a QR
 * holding `payload` (as printed cards do), optionally with its middle covered (finder patterns still visible).
 */
async function photo(seed: number, card?: { payload: string; damaged?: boolean }) {
  const background = { r: (seed * 37) % 256, g: (seed * 91) % 256, b: 120 };
  const layers: OverlayOptions[] = [];
  if (card) {
    let png = await QRCode.toBuffer(card.payload, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 300,
    });
    if (card.damaged)
      png = await sharp(png)
        .composite([
          {
            input: { create: { width: 210, height: 75, channels: 3, background: "#000" } },
            left: 45,
            top: 112,
          },
        ])
        .png()
        .toBuffer();
    layers.push({ input: png, left: 2600, top: 2300 });
  }
  return sharp({ create: { width: 6000, height: 4000, channels: 3, background } })
    .composite(layers)
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** The job's card codes, read through the Data API as the signed-in owner (row-level security; ADR 0015). */
async function cardCodes(page: Page, jobId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL_CA;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_CA;
  if (!url || !key)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL_CA and _PUBLISHABLE_KEY_CA are needed");
  const jar = await page.context().cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.map((c) => ({ name: c.name, value: c.value })), setAll: () => {} },
  });
  const { data, error } = await supabase
    .from("qr_cards")
    .select("id, child_id, card_code")
    .eq("job_id", jobId);
  if (error) throw new Error(error.message);
  return data as { id: string; child_id: string | null; card_code: string }[];
}

const pastDay = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

test("QR tagging: cards sort photos to children, review fixes the rest, and the checklist ticks", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Tagging Studio ${tag}`,
    slug: `tg-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `tagging-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");

  // A job with class "Room 4" (Maya, Liam) and Noah without a class; cards for all three and one blank card.
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Tagging ${tag}`, type: "school", pictureDay: pastDay() },
  });
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).job.id as string;
  const room = await page.request.post(`/api/v1/jobs/${jobId}/groups`, {
    data: { name: "Room 4" },
  });
  const roomId = (await room.json()).group.id as string;
  const child = async (data: Record<string, unknown>) =>
    (await (await page.request.post(`/api/v1/jobs/${jobId}/children`, { data })).json()).child
      .id as string;
  const maya = await child({ firstName: "Maya", lastName: "Johnson", groupId: roomId });
  const liam = await child({ firstName: "Liam", lastName: "Chen", groupId: roomId });
  await child({ firstName: "Noah", lastName: "Garcia" });
  expect(
    (
      await page.request.post(`/api/v1/jobs/${jobId}/qr-cards`, { data: { blankCards: 1 } })
    ).status(),
  ).toBe(200);
  const cards = await cardCodes(page, jobId);
  const code = (childId: string | null) =>
    `DBC1:${cards.find((c) => c.child_id === childId)?.card_code ?? ""}`;

  // 1. One upload, in filename order (no capture times): a photo before any card, Maya's card twice, two photos, Liam's
  // card, a photo, a damaged card, a photo, the blank card, a photo.
  const folder = mkdtempSync(join(tmpdir(), "daybell-tagging-"));
  const day = join(folder, "Picture day");
  mkdirSync(day);
  const files: (Parameters<typeof photo>[1] | undefined)[] = [
    undefined,
    { payload: code(maya) },
    { payload: code(maya) },
    undefined,
    undefined,
    { payload: code(liam) },
    undefined,
    { payload: code(liam), damaged: true },
    undefined,
    { payload: code(null) },
    undefined,
  ];
  for (const [i, card] of files.entries())
    writeFileSync(join(day, `IMG_${String(i + 1).padStart(4, "0")}.JPG`), await photo(i + 1, card));

  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = main.getByRole("region", { name: "Upload photos", exact: true });
  await expect(
    sheet.getByRole("radio", { name: "Individual photos (read QR cards)", exact: true }),
  ).toBeChecked();
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(day);
  await expect(sheet.getByText("Done: 11 photos added", { exact: true })).toBeVisible({
    timeout: 90_000,
  });

  // 2. Review: once every photo is read and the upload tagged, one Leftover, two flagged photos and a blank card.
  await main
    .getByRole("navigation", { name: "Photos views", exact: true })
    .getByRole("link", { name: "Review", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/photos/review$`));
  await expect(
    main.getByText("11 photos · 1 in Leftovers · 2 to check", { exact: true }),
  ).toBeVisible({
    timeout: 120_000,
  });
  const markReviewed = main.getByRole("button", { name: "Mark reviewed", exact: true });
  await expect(markReviewed).toBeDisabled();
  await expect(
    main.getByText(
      "Mark reviewed opens once Leftovers is empty: move each photo to a child, or put it in the bin.",
      { exact: true },
    ),
  ).toBeVisible();
  const flagged = main.getByRole("region", { name: "Flagged", exact: true });
  await expect(flagged.getByText("Card unreadable", { exact: true })).toBeVisible();
  await expect(flagged.getByText("Check: after a card", { exact: true })).toBeVisible();

  // 3. Move the Leftover to Noah with Move to…, by keyboard (the non-drag way, WCAG 2.5.7).
  await main.getByRole("checkbox", { name: "Select Leftovers, photo 1", exact: true }).check();
  await main.getByRole("button", { name: "Move to…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move 1 photo", exact: true });
  await dialog.getByRole("searchbox", { name: "Find a child or class", exact: true }).fill("Noah");
  await dialog.getByRole("radio", { name: "Noah Garcia", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("radio", { name: "Noah Garcia", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Move", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(main.getByText("Moved 1 photo to Noah Garcia.", { exact: true })).toBeVisible();
  await expect(
    main.getByText("11 photos · 0 in Leftovers · 2 to check", { exact: true }),
  ).toBeVisible();

  // 4. The damaged card is a card photo; the photo after it looks right.
  await flagged.getByRole("checkbox", { name: "Select Flagged, photo 1", exact: true }).check();
  await main.getByRole("button", { name: "This is a card photo", exact: true }).click();
  await expect(
    main.getByText("Marked 1 card photo. It is hidden from parents.", { exact: true }),
  ).toBeVisible();
  await flagged.getByRole("checkbox", { name: "Select Flagged, photo 1", exact: true }).check();
  await main.getByRole("button", { name: "Looks right", exact: true }).click();
  await expect(main.getByText("Confirmed 1 photo.", { exact: true })).toBeVisible();
  await expect(main.getByRole("region", { name: "Flagged", exact: true })).toHaveCount(0);

  // 5. Drag one of Maya's photos onto Liam. Her strip starts with her two card photos, labelled "Card".
  const album = main.getByRole("region", { name: "Room 4", exact: true });
  await album.getByRole("button", { name: /^Room 4/ }).click();
  await expect(
    album.getByRole("img", { name: "Maya Johnson, photo 4", exact: true }),
  ).toBeVisible();
  await expect(
    album.getByRole("checkbox", { name: "Select Maya Johnson, photo 1", exact: true }),
  ).toHaveCount(0);
  // The tile itself is the draggable list item (the child's row is a list item too).
  await album
    .getByRole("img", { name: "Maya Johnson, photo 4", exact: true })
    .locator("xpath=ancestor::li[1]")
    .dragTo(album.getByRole("heading", { name: "Liam Chen", exact: true }));
  await expect(main.getByText("Moved 1 photo to Liam Chen.", { exact: true })).toBeVisible();

  // 6. Name the blank card's child: they join Room 4 with the card's own code, and get its photo.
  const blank = main.getByRole("region", { name: "Blank card 1", exact: true });
  await blank.getByRole("textbox", { name: "First name", exact: true }).fill("Zoe");
  await blank.getByRole("textbox", { name: "Last name", exact: true }).fill("New");
  await blank
    .getByRole("combobox", { name: "Class", exact: true })
    .selectOption({ label: "Room 4" });
  await blank.getByRole("button", { name: "Add child", exact: true }).click();
  await expect(
    main.getByText("Added Zoe New with the card's access code.", { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("region", { name: "Blank card 1", exact: true })).toHaveCount(0);

  // 7. Clean: Mark reviewed ticks the checklist's Review tagging task.
  await expect(markReviewed).toBeEnabled();
  await markReviewed.click();
  await expect(main.getByText("Tagging marked reviewed.", { exact: true })).toBeVisible();
  await page.goto(`/app/jobs/${jobId}`);
  const checklist = main.getByRole("region", { name: "Checklist", exact: true });
  const reviewRow = checklist.getByRole("listitem").filter({ hasText: "Review tagging" });
  await checklist.getByRole("button", { name: "Show all tasks", exact: true }).click();
  await expect(reviewRow).toContainText("Done");

  // 8. A new upload reopens it (Seenu, answer 4).
  const later = join(folder, "IMG_0100.JPG");
  writeFileSync(later, await photo(100));
  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  await sheet.locator('input[type="file"][accept]').setInputFiles(later);
  await expect(sheet.getByText("Done: 1 photo added", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await page.goto(`/app/jobs/${jobId}`);
  await expect(reviewRow).toContainText("Next");

  // 9. A class photo upload goes to its class's Class photo set (answer 3).
  const classPhoto = join(folder, "CLASS_0001.JPG");
  writeFileSync(classPhoto, await photo(200));
  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  await sheet.getByRole("radio", { name: "Class photo for a class", exact: true }).check();
  await sheet
    .getByRole("combobox", { name: "Class", exact: true })
    .selectOption({ label: "Room 4" });
  await sheet.locator('input[type="file"][accept]').setInputFiles(classPhoto);
  await expect(sheet.getByText("Done: 1 photo added", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await page.goto(`/app/jobs/${jobId}/photos/review`);
  await album.getByRole("button", { name: /^Room 4/ }).click();
  await expect(
    album.getByRole("img", { name: "Room 4 class photo, photo 1", exact: true }),
  ).toBeVisible({
    timeout: 90_000,
  });

  // 10. Another studio sees and changes nothing.
  const someone = (await (await page.request.get(`/api/v1/jobs/${jobId}/photos`)).json()).photos[0]
    .id as string;
  const outsiderTab = await (await browser.newContext()).newPage();
  const outsider = await signUpOwner(outsiderTab, {
    studio: `Other Tagging Studio ${tag}`,
    slug: `tg-other-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `tagging-other-${tag}@example.test`,
  });
  expect((await outsider.request.get(`/api/v1/jobs/${jobId}/tagging`)).status()).toBe(404);
  expect(
    (await outsider.request.get(`/api/v1/jobs/${jobId}/tagging/photos?place=leftovers`)).status(),
  ).toBe(404);
  expect(
    (
      await outsider.request.post(`/api/v1/jobs/${jobId}/photos/move`, {
        data: { photoIds: [someone], target: { kind: "leftovers" } },
      })
    ).status(),
  ).toBe(404);
  expect((await outsider.request.post(`/api/v1/jobs/${jobId}/tagging/review`)).status()).toBe(404);
  const blankCard = cards.find((c) => c.child_id === null)?.id as string;
  expect(
    (
      await outsider.request.post(`/api/v1/jobs/${jobId}/qr-cards/${blankCard}/child`, {
        data: { firstName: "Not", lastName: "Mine" },
      })
    ).status(),
  ).toBe(404);
});
