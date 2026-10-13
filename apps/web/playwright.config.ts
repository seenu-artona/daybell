import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real local Supabase (`supabase start`) and a production build of the app.
 * CI runs them on every pull request, except tests tagged @load, which run on pushes to main (ADR 0013).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    // The studio app is desktop only (D136; ADR 0013); the parent shop is phone first (ADR 0022), so its
    // shop-*.spec.ts files run in the phone project only (they make their own desktop context for the studio's setup).
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /shop-.*\.spec\.ts$/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /shop-.*\.spec\.ts$/ },
  ],
  webServer: {
    command: "pnpm start --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
