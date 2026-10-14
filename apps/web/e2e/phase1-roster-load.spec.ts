import { expect, test } from "@playwright/test";
import { signUpOwner } from "./helpers";

// Load test (ADR 0013): a full-size roster import, People drawing all 5,000 children, and the QR card PDF for all of
// them (ADR 0015: 1,250 double-sided sheets, inside the route's 60-second limit). Tagged @load: CI runs it on pushes to main, not on
// pull requests (agreed with Seenu). Signs up its own studio.
const run = `${Date.now()}`;

test(
  "a 5,000-child roster imports and People draws it",
  { tag: "@load" },
  async ({ page: firstTab }, info) => {
    test.setTimeout(300_000);
    const tag = `${info.project.name}-${run}`;
    const owner = `load-owner-${tag}@example.test`;
    const page = await signUpOwner(firstTab, {
      studio: `Load Studio ${tag}`,
      slug: `load-${tag}`.slice(0, 40).replace(/-+$/, ""),
      email: owner,
    });
    const main = page.getByRole("main");
    const small = await page.request.post("/api/v1/jobs", {
      data: { name: `Small ${tag}`, type: "school", pictureDay: "2026-10-14" },
    });
    const smallJob = (await small.json()).job.id as string;
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        firstName: "Load",
        lastName: `Test ${String(i).padStart(4, "0")}`,
        group: `Load ${i % 20}`,
        studentId: `L-${i}`,
      }));
    expect(
      (
        await page.request.post(`/api/v1/jobs/${smallJob}/children/import`, {
          data: { rows: rows(3) },
        })
      ).status(),
    ).toBe(200);

    const big = await page.request.post("/api/v1/jobs", {
      data: { name: `Load ${tag}`, type: "school", pictureDay: "2026-10-14" },
    });
    const bigJob = (await big.json()).job.id as string;
    const imported = await page.request.post(`/api/v1/jobs/${bigJob}/children/import`, {
      data: { rows: rows(5000) },
      timeout: 120_000,
    });
    expect(imported.status()).toBe(200);
    expect(await imported.json()).toMatchObject({ added: 5000, updated: 0, groupsAdded: 20 });

    // 5,020 hidden child and class events don't push the shown ones out of the latest 50 (filtered before the limit).
    await page.goto("/app");
    await expect(
      main.getByText(`${owner} imported a roster into Load ${tag}`, { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText(`${owner} imported a roster into Small ${tag}`, { exact: true }),
    ).toBeVisible();

    // People loads every page (10 × 500) and draws all 5,000 rows; grouped by class, they fall into 20 classes.
    await page.goto(`/app/jobs/${bigJob}/people`);
    await expect(
      main.getByRole("link", { name: "People 5,000 children", exact: true }),
    ).toBeVisible();
    // The first page must be drawn before "Loading more…" can mean anything: before it, the text isn't there yet.
    await expect(main.getByRole("link", { name: /^Load Test \d{4}$/ }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(main.getByText("Loading more…", { exact: true })).toHaveCount(0, {
      timeout: 60_000,
    });
    await expect(main.getByRole("link", { name: /^Load Test \d{4}$/ })).toHaveCount(5000, {
      timeout: 60_000,
    });
    await expect(main.getByRole("link", { name: "Load Test 4999", exact: true })).toHaveCount(1);
    await main.getByRole("button", { name: "Group: None", exact: true }).click();
    await main.getByLabel("Class", { exact: true }).check();
    await page.keyboard.press("Escape");
    await expect(main.getByRole("button", { name: /^Load \d+ \d+ children$/ })).toHaveCount(20);
    // Search covers the whole roster.
    await main.getByRole("searchbox", { name: "Search children" }).fill("L-4321");
    await expect(main.getByRole("link", { name: /^Load Test \d{4}$/ })).toHaveCount(1);
    await expect(main.getByRole("link", { name: "Load Test 4321", exact: true })).toBeVisible();

    // QR cards for the whole job: 5,000 cards on 1,250 double-sided sheets (2,500 pages), made and built well inside
    // the route's 60 seconds.
    const started = Date.now();
    const cards = await page.request.post(`/api/v1/jobs/${bigJob}/qr-cards`, {
      data: {},
      timeout: 60_000,
    });
    expect(cards.status()).toBe(200);
    expect(cards.headers()["daybell-cards"]).toBe("5000");
    const pdf = (await cards.body()).toString("latin1");
    expect(pdf.match(/\/Type \/Page(?!s)/g)?.length).toBe(2500);
    expect(Date.now() - started).toBeLessThan(45_000);
  },
);
