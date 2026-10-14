import { describe, expect, it } from "vitest";
import { createLoadGuard } from "./load-guard";

describe("createLoadGuard", () => {
  it("drops a slow first page once a newer one has started", () => {
    const guard = createLoadGuard();
    const old = guard.first();
    const fresh = guard.first();
    expect(fresh.finish()).toBe(true);
    expect(old.finish()).toBe(false);
  });

  it("runs one Show more at a time, so a double click fetches one page", () => {
    const guard = createLoadGuard();
    guard.first().finish();
    const more = guard.more();
    expect(more).not.toBeNull();
    expect(guard.more()).toBeNull();
    expect(more?.finish()).toBe(true);
    expect(guard.more()).not.toBeNull();
  });

  it("allows no Show more while a first page loads, and drops one a new search overtook", () => {
    const guard = createLoadGuard();
    guard.first().finish();
    const more = guard.more();
    const search = guard.first();
    expect(guard.more()).toBeNull();
    expect(more?.finish()).toBe(false);
    expect(search.finish()).toBe(true);
    expect(guard.more()).not.toBeNull();
  });
});
