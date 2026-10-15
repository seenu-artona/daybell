// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { StudioContext } from "../../me-context";
import { ShopSettings } from "./shop-settings";

// Settings › Shop (D157; B3a–B3e): read-only facts for everyone; the studio's name as parents see it (D62), the one
// shop address with a Copy button whose result is announced, Taxes and Stripe links only for owners and admins, and
// Soon rows for the logo, coupons and gift cards.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let root: Root;
let container: HTMLDivElement;
const ADDRESS = "https://shop.example.test/shop";
async function render(role: string) {
  const me = {
    email: "",
    studio: { id: "s", name: "North Peak Photo", slug: "np", region: "us", role },
  };
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <StudioContext.Provider value={{ me: me as never, version: 0, changed: () => {} }}>
          <ShopSettings address={ADDRESS} />
        </StudioContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Settings › Shop (D157)", () => {
  it("shows the cards in order, with nothing to change", async () => {
    await render("staff");
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "Look",
      "Shop address",
      "Checkout",
      "Policies",
      "Coupons and gift cards",
    ]);
    expect(container.textContent).toContain("Parents see your studio's name: North Peak Photo");
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(container.textContent?.match(/Soon/g)).toHaveLength(3);
  });

  it("copies the one shop address and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await render("photographer");
    expect(container.querySelector("code")?.textContent).toBe(ADDRESS);
    const copy = container.querySelector(
      'button[aria-label="Copy the shop address"]',
    ) as HTMLButtonElement;
    expect(copy.textContent).toBe("Copy");
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Shop address copied.");
  });

  it("says when the address couldn't be copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await render("owner");
    await act(async () =>
      (
        container.querySelector('button[aria-label="Copy the shop address"]') as HTMLButtonElement
      ).click(),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "We couldn't copy it. Select the address and copy it yourself.",
    );
  });

  it("links Taxes and Stripe for owners and admins only; Price lists for everyone", async () => {
    const links = () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    await render("admin");
    expect(links()).toEqual(["/app/settings/taxes", "/app/settings/payouts", "/app/products"]);
    await render("staff");
    expect(links()).toEqual(["/app/products"]);
  });
});
