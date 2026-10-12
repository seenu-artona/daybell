import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { toPhoto, STUCK_MS } = await import("./photos");

// A photo can be tried again when the worker couldn't read it, or when it has been processing for 15 minutes (its
// message went to the dead-letter queue; review CR1). Never from the bin.
const row = {
  id: "p",
  batch_id: "b",
  status: "processing" as const,
  original_filename: "IMG_0001.JPG",
  byte_size: 10,
  width: null,
  height: null,
  captured_at: null,
  failure_reason: null,
  binned_at: null,
  created_at: "2026-10-11T12:00:00Z",
  updated_at: "2026-10-11T12:00:00Z",
};
const at = Date.parse("2026-10-11T12:00:00Z");

describe("toPhoto: retryable", () => {
  it("only once processing has been stuck for 15 minutes", () => {
    expect(toPhoto(row, null, at + STUCK_MS - 1).retryable).toBe(false);
    expect(toPhoto(row, null, at + STUCK_MS + 1).retryable).toBe(true);
  });
  it("for unreadable photos, but not other failures, and never in the bin", () => {
    const failed = { ...row, status: "failed" as const };
    expect(toPhoto({ ...failed, failure_reason: "unreadable" }, null, at).retryable).toBe(true);
    expect(toPhoto({ ...failed, failure_reason: "not_jpeg" }, null, at).retryable).toBe(false);
    expect(
      toPhoto({ ...failed, failure_reason: "unreadable", binned_at: row.created_at }, null, at)
        .retryable,
    ).toBe(false);
  });
});
