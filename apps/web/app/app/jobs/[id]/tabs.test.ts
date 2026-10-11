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

  it("show coming soon for the unbuilt tabs only", () => {
    for (const tab of ["photos", "shop", "messages", "orders", "settings"])
      expect(isSoonTab(tab)).toBe(true);
    for (const tab of ["", "people", "import", "overview", "nope"])
      expect(isSoonTab(tab)).toBe(false);
  });
});
