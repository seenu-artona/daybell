import { createHash, randomFillSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { signUpOwner } from "./helpers";

// Phase 1 step 4 "Photo storage and upload" (D39, D60, D100, D140, D142; ADR 0016), with STORAGE_DRIVER=local: a
// folder upload with a duplicate, a PNG and a hidden file; previews made once; the checklist's Upload photos task (D143;
// ADR 0017); the bin; a dropped
// connection; a reload and a second drop that resumes; and another studio that can't see any of it. Desktop only
// (D136). JPEGs are made in the test.
const run = `${Date.now()}`;

/** A JPEG with its own content: `seed` changes the colour; `noise` makes it large (random pixels don't compress). */
async function jpeg(
  seed: number,
  options: { width?: number; height?: number; noise?: boolean } = {},
) {
  const width = options.width ?? 640;
  const height = options.height ?? 480;
  if (options.noise) {
    const raw = randomFillSync(Buffer.alloc(width * height * 3));
    return sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: false })
      .toBuffer();
  }
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: (seed * 53) % 256, g: 120, b: (seed * 17) % 256 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function newJob(page: Page, tag: string, pictureDay: string): Promise<string> {
  const created = await page.request.post("/api/v1/jobs", {
    data: { name: `Photos ${tag}`, type: "seniors", pictureDay },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).job.id as string;
}

// Two days ago in UTC: every time zone's date is within a day of UTC's, so this day has passed wherever the browser
// runs and the Picture day task has ticked itself (the app counts days in the browser's own zone).
const pastDay = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

test("Photos: a folder upload, previews, the checklist task, the bin, and nothing for another studio", async ({
  page: firstTab,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Photo Studio ${tag}`,
    slug: `ph-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `photo-owner-${tag}@example.test`,
  });
  const main = page.getByRole("main");
  const jobId = await newJob(page, tag, pastDay());
  // One child and no QR cards yet, so the checklist is still at Set up and shows every task.
  expect(
    (
      await page.request.post(`/api/v1/jobs/${jobId}/children`, {
        data: { firstName: "Maya", lastName: "Johnson" },
      })
    ).status(),
  ).toBe(201);

  // 1. Overview: Picture day has passed, so it ticked itself; Upload photos is to do, and its row links to Photos.
  await page.goto(`/app/jobs/${jobId}`);
  const checklist = main.getByRole("region", { name: "Checklist", exact: true });
  await expect(checklist.getByRole("listitem").filter({ hasText: /^Picture day/ })).toContainText(
    "Done",
  );
  const todo = checklist.getByRole("listitem").filter({ hasText: "Upload photos" });
  await expect(todo).toContainText("To do");
  await todo.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/photos$`));
  await expect(main.getByRole("heading", { name: "No photos yet", exact: true })).toBeVisible();

  // 2. A folder: two photos, the same photo again under another name, a PNG and a hidden file.
  const folder = mkdtempSync(join(tmpdir(), "daybell-photos-"));
  const day = join(folder, "Picture day");
  mkdirSync(day);
  const one = await jpeg(1);
  writeFileSync(join(day, "IMG_0001.JPG"), one);
  writeFileSync(join(day, "IMG_0002.jpg"), await jpeg(2));
  // Which of two identical files is kept depends on the order the browser lists the folder; either name sorts before
  // IMG_0002, so the order of the photos below doesn't.
  writeFileSync(join(day, "IMG_0001 copy.JPG"), one);
  writeFileSync(
    join(day, "notes.png"),
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
      .png()
      .toBuffer(),
  );
  writeFileSync(join(day, ".DS_Store"), "x");

  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = main.getByRole("region", { name: "Upload photos", exact: true });
  await expect(sheet.getByRole("button", { name: "Choose folder", exact: true })).toBeVisible();
  await sheet.locator('input[type="file"][webkitdirectory]').setInputFiles(day);
  await expect(
    sheet.getByText("Done: 2 photos added · 1 duplicate skipped", { exact: true }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    sheet.getByText("1 file skipped: not a JPEG, empty or over 50 MB", { exact: true }),
  ).toBeVisible();

  // 3. Previews are made once, then shown in tagging order.
  await expect(main.getByRole("heading", { name: "2 photos", exact: true })).toBeVisible();
  await expect(main.getByRole("img", { name: "Photo 1", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(main.getByRole("img", { name: "Photo 2", exact: true })).toBeVisible({
    timeout: 60_000,
  });

  // 4. The panel: the 1600 px preview, the file's name, and the photo's id (never its name) in the URL.
  await main.getByRole("button", { name: "Open photo 2", exact: true }).click();
  const panel = main.getByRole("complementary", { name: "IMG_0002.jpg", exact: true });
  await expect(panel.getByRole("img", { name: "Photo 2", exact: true })).toBeVisible();
  await expect(panel.getByText("Ready", { exact: true }).first()).toBeVisible();
  expect(page.url()).toMatch(/\?photo=[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain("IMG_");

  // 5. The checklist's Upload photos task ticked itself.
  await page.goto(`/app/jobs/${jobId}`);
  await expect(todo).toContainText("Done");
  await expect(checklist.getByText("4 of 5 done", { exact: true })).toBeVisible();

  // 6. The bin: move one photo there and back.
  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("checkbox", { name: "Select photo 2", exact: true }).check();
  await main.getByRole("button", { name: "Move to bin", exact: true }).click();
  await expect(main.getByText("Moved 1 photo to the bin.", { exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { name: "1 photo", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Bin (1)", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "1 photo in the bin", exact: true }),
  ).toBeVisible();
  await main.getByRole("checkbox", { name: "Select photo 1", exact: true }).check();
  await main.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(main.getByText("Restored 1 photo.", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Back to photos", exact: true }).click();
  await expect(main.getByRole("heading", { name: "2 photos", exact: true })).toBeVisible();

  // 7. Another studio sees nothing: not the job's photos, a photo, its previews or an upload.
  const list = await page.request.get(`/api/v1/jobs/${jobId}/photos`);
  const photoId = (await list.json()).photos[0].id as string;
  const outsiderTab = await (await browser.newContext()).newPage();
  const outsider = await signUpOwner(outsiderTab, {
    studio: `Other Photo Studio ${tag}`,
    slug: `ph-other-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `photo-other-${tag}@example.test`,
  });
  expect((await outsider.request.get(`/api/v1/jobs/${jobId}/photos`)).status()).toBe(404);
  expect((await outsider.request.get(`/api/v1/jobs/${jobId}/photos/summary`)).status()).toBe(404);
  expect((await outsider.request.get(`/api/v1/photos/${photoId}`)).status()).toBe(404);
  expect((await outsider.request.post(`/api/v1/jobs/${jobId}/upload-batches`)).status()).toBe(404);
  expect(
    (
      await outsider.request.post(`/api/v1/jobs/${jobId}/photos/bin`, {
        data: { photoIds: [photoId] },
      })
    ).status(),
  ).toBe(404);
});

test("Photos: an upload waits out a dropped connection, and a reload resumes with only the missing parts", async ({
  page: firstTab,
  context,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${info.project.name}-${run}`;
  const page = await signUpOwner(firstTab, {
    studio: `Resume Studio ${tag}`,
    slug: `rs-${tag}`.slice(0, 40).replace(/-+$/, ""),
    email: `photo-resume-${tag}@example.test`,
  });
  const main = page.getByRole("main");
  const jobId = await newJob(page, tag, "2030-05-01");
  const folder = mkdtempSync(join(tmpdir(), "daybell-resume-"));

  // A photo of three parts (over 16 MiB), so parts are in flight when the connection drops.
  const big = await jpeg(7, { width: 3000, height: 2600, noise: true });
  expect(big.length).toBeGreaterThan(16 * 1024 * 1024);
  const bigPath = join(folder, "BIG_0001.JPG");
  writeFileSync(bigPath, big);

  // 1. The connection drops mid-upload: the upload says it is waiting, then carries on.
  await page.goto(`/app/jobs/${jobId}/photos`);
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  const sheet = main.getByRole("region", { name: "Upload photos", exact: true });
  // Parts are held back for a moment, so they are still in flight when the connection drops.
  await page.route("**/api/dev-storage/**", async (route) => {
    if (route.request().method() === "PUT") await new Promise((ok) => setTimeout(ok, 3000));
    return route.continue().catch(() => {});
  });
  const firstPut = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().includes("/api/dev-storage/"),
  );
  await sheet.locator('input[type="file"][accept]').setInputFiles(bigPath);
  await firstPut;
  await context.setOffline(true);
  await expect(sheet.getByText("Waiting for your connection…", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.setOffline(false);
  await expect(sheet.getByText("Done: 1 photo added", { exact: true })).toBeVisible({
    timeout: 90_000,
  });

  // 2. A second photo: part 1 arrives; parts 2 and 3 never do (each try fails at once, as on a dead connection, so
  // the upload keeps retrying them), and the page is reloaded mid-upload. They are refused, not held: removing a route
  // that is holding requests lets the browser send them on, and the "interrupted" upload would quietly complete.
  const second = await jpeg(8, { width: 3000, height: 2600, noise: true });
  const secondPath = join(folder, "BIG_0002.JPG");
  writeFileSync(secondPath, second);
  const laterPart = (r: { method(): string; url(): string }) =>
    r.method() === "PUT" &&
    r.url().includes("/api/dev-storage/") &&
    new URL(r.url()).searchParams.get("partNumber") !== "1";
  await page.route("**/api/dev-storage/**", (route) =>
    laterPart(route.request()) ? route.abort("internetdisconnected") : route.continue(),
  );
  const partOne = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" && new URL(r.url()).searchParams.get("partNumber") === "1",
  );
  const laterRefused = page.waitForEvent("requestfailed", laterPart);
  await sheet.locator('input[type="file"][accept]').setInputFiles(secondPath);
  expect((await partOne).status()).toBe(200);
  await laterRefused;
  // Leaving mid-upload asks first (beforeunload); leave.
  page.once("dialog", (d) => d.accept());
  await page.reload();
  // The route stays across the reload until here, so nothing of the old page's upload gets through.
  await page.unrouteAll({ behavior: "wait" });

  // 3. Dropping the same file again resumes: the server knows part 1 arrived, so only the rest are sent.
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/api/dev-storage/"))
      puts.push(new URL(r.url()).searchParams.get("partNumber") ?? "");
  });
  await main.getByRole("button", { name: "Upload photos", exact: true }).click();
  await main
    .getByRole("region", { name: "Upload photos", exact: true })
    .locator('input[type="file"][accept]')
    .setInputFiles(secondPath);
  await expect(main.getByText("Done: 1 photo added", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  expect(puts.length).toBeGreaterThan(0);
  expect(puts).not.toContain("1");
  // And it is the same photo, once.
  await expect(main.getByRole("heading", { name: "2 photos", exact: true })).toBeVisible();
});

test(
  "Photos: registering 5,000 photos in ten requests",
  { tag: "@load" },
  async ({ page: firstTab }, info) => {
    test.setTimeout(300_000);
    const tag = `${info.project.name}-${run}`;
    const page = await signUpOwner(firstTab, {
      studio: `Photo Load ${tag}`,
      slug: `pl-${tag}`.slice(0, 40).replace(/-+$/, ""),
      email: `photo-load-${tag}@example.test`,
    });
    const jobId = await newJob(page, tag, "2030-05-01");
    const batch = await page.request.post(`/api/v1/jobs/${jobId}/upload-batches`);
    expect(batch.status()).toBe(201);
    const batchId = (await batch.json()).batchId as string;
    const started = Date.now();
    for (let chunk = 0; chunk < 10; chunk++) {
      const files = Array.from({ length: 500 }, (_, i) => {
        const n = chunk * 500 + i;
        return {
          name: `IMG_${String(n).padStart(5, "0")}.JPG`,
          size: 12_000_000,
          sha256: createHash("sha256").update(`photo-${tag}-${n}`).digest("hex"),
        };
      });
      const res = await page.request.post(`/api/v1/upload-batches/${batchId}/files`, {
        data: { files },
      });
      expect(res.status()).toBe(200);
      const results = (await res.json()).results as { outcome: string }[];
      expect(results.every((r) => r.outcome === "new")).toBe(true);
    }
    const counts = (await (await page.request.get(`/api/v1/jobs/${jobId}/photos/summary`)).json())
      .counts;
    expect(counts.uploading).toBe(5000);
    // Each request of 500 well under the function limit (about 1 s locally).
    expect(Date.now() - started).toBeLessThan(120_000);
  },
);
