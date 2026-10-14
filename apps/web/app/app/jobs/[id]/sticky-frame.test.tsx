// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StickyFrame } from "./sticky-frame";

// The D144 sticky job frame with IntersectionObserver faked: the sentinel leaving the (extended) window marks the
// block stuck; only then do the back link and the small name (hidden from screen readers) show, beside the same tab
// navigation element. The header knows it is stuck (its own back link steps aside), and focus moving into it scrolls
// the page back so its controls stay reachable, instantly with reduced motion.
let root: Root;
let container: HTMLDivElement;
let report: (entry: Partial<IntersectionObserverEntry>) => void = () => {};
let reduce = false;
const scrollIntoView = vi.fn();

class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    report = (entry) => callback([entry as IntersectionObserverEntry], this as never);
  }
  observe() {}
  disconnect() {}
}

beforeEach(async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce, media: query }));
  Element.prototype.scrollIntoView = scrollIntoView;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <StickyFrame
        name="Lincoln Elementary"
        backHref="/app/jobs"
        backLabel="All jobs"
        header={(stuck) => (
          <header data-stuck-header={stuck ? "yes" : "no"}>
            <h1>Lincoln Elementary</h1>
            <button type="button">More actions</button>
          </header>
        )}
        tabs={<nav aria-label="Job sections" />}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  scrollIntoView.mockClear();
  reduce = false;
});

const block = () => container.querySelector("[data-sticky-header]") as HTMLElement;
const stick = (on: boolean) =>
  act(async () =>
    report({
      isIntersecting: !on,
      boundingClientRect: { top: on ? -200 : 20 } as DOMRectReadOnly,
    }),
  );

describe("StickyFrame (D144)", () => {
  it("is not stuck at first: no second back link and no small name", () => {
    expect(block().hasAttribute("data-stuck")).toBe(false);
    expect(container.querySelector('a[aria-label="All jobs"]')).toBeNull();
    expect(container.querySelector("[data-sticky-name]")).toBeNull();
    expect(container.querySelector("[data-stuck-header]")?.getAttribute("data-stuck-header")).toBe(
      "no",
    );
  });

  it("when stuck shows the back link and the name hidden from screen readers, beside the same tab nav", async () => {
    const nav = container.querySelector('nav[aria-label="Job sections"]');
    await stick(true);
    expect(block().hasAttribute("data-stuck")).toBe(true);
    const back = container.querySelector('a[aria-label="All jobs"]');
    expect(back?.getAttribute("href")).toBe("/app/jobs");
    const name = container.querySelector("[data-sticky-name]");
    expect(name?.textContent).toBe("Lincoln Elementary");
    expect(name?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('nav[aria-label="Job sections"]')).toBe(nav);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("[data-stuck-header]")?.getAttribute("data-stuck-header")).toBe(
      "yes",
    );
    await stick(false);
    expect(container.querySelector('a[aria-label="All jobs"]')).toBeNull();
  });

  it("scrolls back to the header when focus moves into it while stuck, instantly with reduced motion", async () => {
    const more = () => container.querySelector("header button") as HTMLButtonElement;
    more().focus();
    expect(scrollIntoView).not.toHaveBeenCalled();
    more().blur();
    await stick(true);
    more().focus();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", behavior: "smooth" });
    more().blur();
    reduce = true;
    more().focus();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", behavior: "instant" });
  });
});
