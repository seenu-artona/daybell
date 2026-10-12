import { describe, expect, it, vi } from "vitest";
import { onRestoredFromCache } from "./page-restored";

// Code review N2 (ADR 0020): coming Back from Stripe restores the page from the back-forward cache with "Opening
// Stripe…" still showing; the page resets it on a persisted pageshow, and only then.
const pageshow = (persisted: boolean) => Object.assign(new Event("pageshow"), { persisted });

describe("onRestoredFromCache", () => {
  it("calls back when the page comes back from the back-forward cache, not on a normal load", () => {
    const target = new EventTarget();
    const restored = vi.fn();
    const stop = onRestoredFromCache(target, restored);
    target.dispatchEvent(pageshow(false));
    expect(restored).not.toHaveBeenCalled();
    target.dispatchEvent(pageshow(true));
    expect(restored).toHaveBeenCalledTimes(1);
    stop();
    target.dispatchEvent(pageshow(true));
    expect(restored).toHaveBeenCalledTimes(1);
  });
});
