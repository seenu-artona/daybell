import { describe, expect, it } from "vitest";
import { SECTIONS, SOON_SECTIONS, sectionForPath } from "./nav";

describe("sectionForPath", () => {
  it("highlights the right menu item", () => {
    expect(sectionForPath("/app")).toBe("home");
    expect(sectionForPath("/app/")).toBe("home");
    expect(sectionForPath("/app/settings")).toBe("settings");
    expect(sectionForPath("/app/orders/123")).toBe("orders");
    expect(sectionForPath("/app/jobs/new")).toBe("jobs");
    expect(sectionForPath("/app/people/clients")).toBe("people");
    expect(sectionForPath("/app/analytics")).toBe("analytics");
  });

  it("highlights nothing for pages outside the menu", () => {
    expect(sectionForPath("/app/help")).toBeNull();
    expect(sectionForPath("/app/ordersx")).toBeNull();
  });

  it("lists every unbuilt section as soon", () => {
    expect(SOON_SECTIONS).toEqual(SECTIONS.filter((s) => !s.built).map((s) => s.key));
  });

  it("lists the D150 sections in menu order, Settings last", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      "home",
      "jobs",
      "orders",
      "products",
      "people",
      "shop",
      "analytics",
      "settings",
    ]);
  });

  it("has Shop and Analytics as Soon, and no Marketing, Money, Reports or Activity (D149, D150)", () => {
    expect(SOON_SECTIONS).toEqual(["shop", "analytics"]);
    const keys: string[] = SECTIONS.map((s) => s.key);
    for (const gone of ["marketing", "money", "reports", "activity", "contacts"])
      expect(keys).not.toContain(gone);
  });

  it("highlights People on each of its sections (D150, ADR 0028)", () => {
    for (const section of ["", "/clients", "/contacts", "/families", "/subjects"])
      expect(sectionForPath(`/app/people${section}`)).toBe("people");
    expect(sectionForPath("/app/peoplex")).toBeNull();
  });

  it("highlights Shop on the shop preview, which lives under it (D150)", () => {
    expect(sectionForPath("/app/shop")).toBe("shop");
    expect(sectionForPath("/app/shop/preview")).toBe("shop");
  });

  it("highlights Jobs on every job page section (D137)", () => {
    expect(sectionForPath("/app/jobs/0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e/people")).toBe("jobs");
    expect(sectionForPath("/app/jobs/0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e/import")).toBe("jobs");
  });

  it("has jobs and people built (Phase 1 step 1), products (step 6, ADR 0019) and orders (step 11)", () => {
    expect(SOON_SECTIONS).not.toContain("jobs");
    expect(SOON_SECTIONS).not.toContain("people");
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
