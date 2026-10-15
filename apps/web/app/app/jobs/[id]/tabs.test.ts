import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupHref, groupsHref, JOB_TABS, reviewHref, tabForPath, tabHref } from "./tabs";

const ID = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";

describe("job tabs", () => {
  it("are the five sections in order; Messages and Settings are dropped (D150)", () => {
    expect(JOB_TABS.map((t) => t.key)).toEqual(["overview", "people", "photos", "shop", "orders"]);
  });

  it("have no Messages or Settings route any more (D150): those addresses are 404s", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    expect(existsSync(join(here, "messages"))).toBe(false);
    expect(existsSync(join(here, "settings"))).toBe(false);
  });

  it("link to real routes", () => {
    expect(tabHref(ID, "overview")).toBe(`/app/jobs/${ID}`);
    expect(tabHref(ID, "people")).toBe(`/app/jobs/${ID}/people`);
    expect(tabHref(ID, "orders")).toBe(`/app/jobs/${ID}/orders`);
  });

  it("link Photos' To review chip, Groups and a group's page by id (ADR 0030)", () => {
    expect(reviewHref(ID)).toBe(`/app/jobs/${ID}/photos?show=review`);
    expect(groupsHref(ID)).toBe(`/app/jobs/${ID}/photos/groups`);
    expect(groupHref(ID, "none")).toBe(`/app/jobs/${ID}/photos/groups/none`);
    expect(tabForPath(`/app/jobs/${ID}/photos/groups/none`)).toBe("photos");
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
