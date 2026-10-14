import { describe, expect, it } from "vitest";
import { SECTIONS, SOON_SECTIONS, sectionForPath } from "./nav";

describe("sectionForPath", () => {
  it("highlights the right menu item", () => {
    expect(sectionForPath("/app")).toBe("home");
    expect(sectionForPath("/app/")).toBe("home");
    expect(sectionForPath("/app/settings")).toBe("settings");
    expect(sectionForPath("/app/orders/123")).toBe("orders");
    expect(sectionForPath("/app/jobs/new")).toBe("jobs");
    expect(sectionForPath("/app/contacts/clients")).toBe("contacts");
  });

  it("highlights nothing for pages outside the menu", () => {
    expect(sectionForPath("/app/shop")).toBeNull();
    expect(sectionForPath("/app/ordersx")).toBeNull();
  });

  it("lists every unbuilt section as soon", () => {
    expect(SOON_SECTIONS).toEqual(SECTIONS.filter((s) => !s.built).map((s) => s.key));
  });

  it("lists the D126 sections in menu order, Settings last", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      "home",
      "jobs",
      "orders",
      "products",
      "contacts",
      "marketing",
      "money",
      "reports",
      "settings",
    ]);
  });

  it("highlights Jobs on every job page section (D137)", () => {
    expect(sectionForPath("/app/jobs/0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e/people")).toBe("jobs");
    expect(sectionForPath("/app/jobs/0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e/import")).toBe("jobs");
  });

  it("has jobs and contacts built (Phase 1 step 1), products (step 6, ADR 0019) and orders (step 11)", () => {
    expect(SOON_SECTIONS).not.toContain("jobs");
    expect(SOON_SECTIONS).not.toContain("contacts");
    expect(SOON_SECTIONS).not.toContain("products");
    expect(SOON_SECTIONS).not.toContain("orders");
  });

  it("highlights Products on its price list pages", () => {
    expect(sectionForPath("/app/products")).toBe("products");
    expect(sectionForPath("/app/products/price-lists/0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e")).toBe(
      "products",
    );
  });
});
