import { describe, expect, it, vi } from "vitest";

// The DRM test token route's per-person budget (spike; D158; ADR 0032).
vi.mock("server-only", () => ({}));
const { createTokenBudget, DRM_TOKENS_PER_MINUTE } = await import("./drm-test-throttle");

describe("createTokenBudget", () => {
  it("allows 30 a minute per person, then says how long to wait", () => {
    expect(DRM_TOKENS_PER_MINUTE).toBe(30);
    const budget = createTokenBudget();
    const t = Date.parse("2026-10-14T12:00:15Z");
    for (let i = 0; i < 30; i++) expect(budget.take("a", t)).toEqual({ ok: true });
    expect(budget.take("a", t)).toEqual({ ok: false, retryAfterSeconds: 45 });
    // Someone else has their own budget.
    expect(budget.take("b", t)).toEqual({ ok: true });
  });

  it("starts again in the next minute", () => {
    const budget = createTokenBudget(1);
    const t = Date.parse("2026-10-14T12:00:59.500Z");
    expect(budget.take("a", t).ok).toBe(true);
    expect(budget.take("a", t)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(budget.take("a", t + 1000).ok).toBe(true);
  });

  it("drops finished windows instead of growing without bound", () => {
    const budget = createTokenBudget();
    const t = Date.parse("2026-10-14T12:00:00Z");
    for (let i = 0; i < 1000; i++) budget.take(`u${i}`, t);
    expect(budget.size()).toBe(1000);
    budget.take("late", t + 60_000);
    expect(budget.size()).toBe(1);
  });
});
