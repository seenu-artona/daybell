import { describe, expect, it, vi } from "vitest";
import { createLoadTracker } from "./load-tracker";

describe("createLoadTracker", () => {
  it("is loading from the first start until the last end", () => {
    const onChange = vi.fn();
    const tracker = createLoadTracker(onChange);
    const endA = tracker.start();
    const endB = tracker.start();
    expect(onChange.mock.calls).toEqual([[true]]);
    expect(tracker.size).toBe(2);
    endA();
    expect(onChange.mock.calls).toEqual([[true]]);
    endB();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(tracker.size).toBe(0);
  });

  it("counts each load once, however many times it ends (settled, then unmounted)", () => {
    const onChange = vi.fn();
    const tracker = createLoadTracker(onChange);
    const endA = tracker.start();
    const endB = tracker.start();
    endA();
    endA();
    expect(tracker.size).toBe(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    endB();
    endB();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("ends a load whose section unmounts before it settles", () => {
    const onChange = vi.fn();
    const tracker = createLoadTracker(onChange);
    const unmount = tracker.start();
    unmount();
    expect(tracker.size).toBe(0);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("ends a load that fails", async () => {
    const onChange = vi.fn();
    const tracker = createLoadTracker(onChange);
    const end = tracker.start();
    await Promise.reject(new Error("network"))
      .catch(() => {})
      .finally(end);
    expect(tracker.size).toBe(0);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("starts again after going idle", () => {
    const onChange = vi.fn();
    const tracker = createLoadTracker(onChange);
    tracker.start()();
    tracker.start();
    expect(onChange.mock.calls).toEqual([[true], [false], [true]]);
    expect(tracker.size).toBe(1);
  });
});
