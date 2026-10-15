import { devices, expect, type Page, test } from "@playwright/test";
import { studioSellingAva } from "./helpers";

// The large view's DRM fallback (D158; ADR 0034, C1, C2), on a phone (Pixel 7, this project) and on a computer (a
// Desktop Chrome context made here). The local driver packages nothing, so the test pretends: the browser claims
// hardware Widevine (EME stubbed), GET /shop/drm says DRM is on, the gallery marks its photos protected, and the
// manifest never answers. Each large view first tries DRM ("Loading photo" over the proof), then falls back to the
// watermarked WebP within 8 seconds, silently, even when GET /shop/drm itself never answers; after two failures in a
// row the tab shows the WebP at once; nothing breaks the shop's Content-Security-Policy and nothing is logged as an
// error. On the computer the WebP is under Blackout (the window losing focus turns it dark, with words). One studio is
// set up for all three. Locators are scoped to the viewer dialog and exact.
test.use({ reducedMotion: "reduce" });

const run = `${Date.now()}`;
const HIDDEN = "Photo hidden while a screenshot may be taken. It comes back in a moment.";

/** Hardware Widevine, as far as the page can tell, and a record of every CSP violation. Runs before the page's scripts. */
function pretendHardwareDrm() {
  const w = window as unknown as { __cspViolations: string[] };
  w.__cspViolations = [];
  document.addEventListener("securitypolicyviolation", (e) =>
    w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
  );
  Object.defineProperty(navigator, "requestMediaKeySystemAccess", {
    configurable: true,
    value: async (keySystem: string, configs: MediaKeySystemConfiguration[]) => {
      if (keySystem !== "com.widevine.alpha")
        throw new DOMException("Unsupported", "NotSupportedError");
      return {
        keySystem,
        getConfiguration: () => configs[0],
        // Never reached: the manifest never answers.
        createMediaKeys: () => new Promise(() => {}),
      };
    },
  });
}

/** DRM "on" for this page: the setup, protected photos, and manifests that never answer (counted). */
async function routeDrm(page: Page, options: { setupHangs?: boolean } = {}): Promise<string[]> {
  const manifests: string[] = [];
  await page.route("**/api/v1/shop/drm?*", (route) => {
    // Left unanswered: the photo's own 8-second budget covers the setup too.
    if (options.setupHangs) return;
    return route.fulfill({
      json: {
        enabled: true,
        licenseUrls: {
          widevine: "https://e2e.drm-widevine-licensing.axprod.net/AcquireLicense",
          playready: "https://e2e.drm-playready-licensing.axprod.net/AcquireLicense",
          fairplay: null,
        },
        fairplayCertificateUrl: null,
        codec: "avc1.640028",
      },
      headers: { "cache-control": "no-store" },
    });
  });
  await page.route("**/api/v1/shop/children/*/gallery?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const photo of [...body.portraits, ...body.groupPhotos]) photo.drm = true;
    if (body.cover) body.cover.drm = true;
    await route.fulfill({ response, json: body });
  });
  await page.route("**/drm-manifest?*", (route) => {
    // Left unanswered: the viewer's own 8-second limit is what ends the wait.
    manifests.push(route.request().url());
  });
  return manifests;
}

async function openGallery(page: Page, code: string) {
  const main = page.getByRole("main");
  await page.goto("/shop");
  await main.getByLabel("Access code", { exact: true }).fill(code);
  await main.getByRole("button", { name: "View photos", exact: true }).click();
  await main.getByRole("button", { name: "See photos", exact: true }).click();
  return main.getByRole("list", { name: "Photos of Ava P.", exact: true });
}

/** One large view: tried under DRM first, then the WebP within 8 seconds, with no words about it. */
async function fallsBackWithin8s(page: Page, n: number) {
  const viewer = page.getByRole("dialog", { name: `Photo ${n} of 2`, exact: true });
  await expect(viewer).toBeVisible();
  const started = Date.now();
  await expect(viewer.locator('[data-drm-photo="loading"]')).toBeVisible();
  await expect(
    viewer.getByRole("img", { name: `Ava, photo ${n} of 2`, exact: true }),
  ).toBeVisible();
  await expect(viewer.locator('img[src*="/proof-thumb.webp?"]')).toBeVisible();
  await expect(viewer.getByText("Loading photo", { exact: true })).toBeVisible();
  const webp = viewer.locator('img[src*="/proof.webp?"]');
  await expect(webp).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(9_500);
  await expect(webp).toHaveAttribute("alt", `Ava, photo ${n} of 2`);
  await expect(viewer.locator("[data-drm-photo]")).toHaveCount(0);
  await expect(viewer.getByText("Loading photo", { exact: true })).toHaveCount(0);
  return viewer;
}

/** Every console error and uncaught page error, collected to be checked at the end: there must be none (review). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function cleanEnd(page: Page, errors: string[]) {
  expect(
    await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations),
  ).toEqual([]);
  expect(errors).toEqual([]);
}

// One studio for every test here (review: set up once, not per test).
test.describe
  .serial("the large view's DRM fallback", () => {
    let code = "";

    test.beforeAll(async ({ browser }, info) => {
      test.setTimeout(300_000);
      const studio = await studioSellingAva(
        browser,
        info.project.use.baseURL as string,
        `drm-${run}`,
      );
      code = studio.code;
      await studio.context.close();
    });

    test("on a phone: tries DRM, falls back to the WebP within 8 s, then the WebP for the tab", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      await page.addInitScript(pretendHardwareDrm);
      const manifests = await routeDrm(page);
      const grid = await openGallery(page, code);

      await grid.getByRole("button", { name: "Ava, photo 1 of 2", exact: true }).click();
      const first = await fallsBackWithin8s(page, 1);
      await first.getByRole("button", { name: "Next photo", exact: true }).click();
      const second = await fallsBackWithin8s(page, 2);
      expect(manifests).toHaveLength(2);
      for (const url of manifests)
        expect(url).toMatch(/drm-manifest\?format=dash&gallery=[0-9a-f]{32}$/);

      // Two failures in a row: the rest of the tab shows the WebP at once, without asking for a manifest (C2).
      await second.getByRole("button", { name: "Previous photo", exact: true }).click();
      const again = page.getByRole("dialog", { name: "Photo 1 of 2", exact: true });
      await expect(again.locator('img[src*="/proof.webp?"]')).toBeVisible({ timeout: 2_000 });
      await expect(again.locator("[data-drm-photo]")).toHaveCount(0);
      expect(manifests).toHaveLength(2);
      // Phones keep round 7's blur, never Blackout's panel (C1, review #6c).
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await expect(page.locator('[data-shop-protection="blurred"]')).toHaveCount(1);
      await expect(again.getByText(HIDDEN, { exact: true })).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator('[data-shop-protection="clear"]')).toHaveCount(1);
      await cleanEnd(page, errors);
    });

    test("on a phone, a setup that never answers: the WebP within 8 s (review: tester #1)", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      await page.addInitScript(pretendHardwareDrm);
      const manifests = await routeDrm(page, { setupHangs: true });
      const grid = await openGallery(page, code);
      await grid.getByRole("button", { name: "Ava, photo 1 of 2", exact: true }).click();
      await fallsBackWithin8s(page, 1);
      expect(manifests).toHaveLength(0);
      await cleanEnd(page, errors);
    });

    test("on a computer: the same fallback, under Blackout", async ({ browser }, info) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({
        ...devices["Desktop Chrome"],
        baseURL: info.project.use.baseURL as string,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.addInitScript(pretendHardwareDrm);
      const manifests = await routeDrm(page);
      const grid = await openGallery(page, code);

      await grid.getByRole("button", { name: "Ava, photo 1 of 2", exact: true }).click();
      const viewer = await fallsBackWithin8s(page, 1);
      expect(manifests).toHaveLength(1);

      // Blackout on the fallback (C1): dark with words while the window has no focus, back after.
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await expect(page.locator('[data-shop-protection="dark"]')).toHaveCount(1);
      await expect(viewer.getByText(HIDDEN, { exact: true })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator('[data-shop-protection="clear"]')).toHaveCount(1);
      await expect(viewer.getByText(HIDDEN, { exact: true })).toHaveCount(0);

      await cleanEnd(page, errors);
      await context.close();
    });
  });
