import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSoonTab, JOB_TABS, tabForPath, tabHref } from "./tabs";

const ID = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";

describe("job tabs", () => {
  it("are the seven D137 sections in order", () => {
    expect(JOB_TABS.map((t) => t.key)).toEqual([
      "overview",
      "people",
      "photos",
      "shop",
      "messages",
      "orders",
      "settings",
    ]);
  });

  it("link to real routes", () => {
    expect(tabHref(ID, "overview")).toBe(`/app/jobs/${ID}`);
    expect(tabHref(ID, "people")).toBe(`/app/jobs/${ID}/people`);
    expect(tabHref(ID, "settings")).toBe(`/app/jobs/${ID}/settings`);
  });

  it("know which tab a path is on; import belongs to People", () => {
    expect(tabForPath(`/app/jobs/${ID}`)).toBe("overview");
    expect(tabForPath(`/app/jobs/${ID}/`)).toBe("overview");
    expect(tabForPath(`/app/jobs/${ID}/people`)).toBe("people");
    expect(tabForPath(`/app/jobs/${ID}/import`)).toBe("people");
    expect(tabForPath(`/app/jobs/${ID}/orders`)).toBe("orders");
  });

  it("know nothing outside a job", () => {
    expect(tabForPath("/app/jobs")).toBeNull();
    expect(tabForPath("/app/jobs/new")).toBeNull();
    expect(tabForPath(`/app/jobs/${ID}/nope`)).toBeNull();
    expect(tabForPath("/app")).toBeNull();
  });

  it("show coming soon for the unbuilt tabs only (Shop since step 6, Orders since step 11)", () => {
    for (const tab of ["messages", "settings"]) expect(isSoonTab(tab)).toBe(true);
    for (const tab of ["", "people", "photos", "shop", "orders", "import", "overview", "nope"])
      expect(isSoonTab(tab)).toBe(false);
  });

  it("each have their own route folder, with no catch-all, so an unknown tab is a real 404", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    for (const { segment } of JOB_TABS)
      expect(existsSync(join(here, segment, "page.tsx")), `page for "${segment}"`).toBe(true);
    const dynamic = readdirSync(here, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name.startsWith("["),
    );
    expect(dynamic.map((e) => e.name)).toEqual([]);
  });
});
