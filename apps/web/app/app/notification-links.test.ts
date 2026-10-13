import { NOTIFICATION_KINDS } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { notificationHref } from "./notification-links";

const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const ORDER = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";

describe("notificationHref", () => {
  it("leads each kind to where it is dealt with, by id only", () => {
    expect(NOTIFICATION_KINDS.map((kind) => notificationHref(kind, JOB, ORDER))).toEqual([
      `/app/jobs/${JOB}`,
      `/app/jobs/${JOB}`,
      "/app/settings/payouts",
      "/app/settings/payouts",
      `/app/jobs/${JOB}/photos`,
      `/app/jobs/${JOB}/photos/review`,
      // Orders (ADR 0024): the order's page.
      `/app/orders/${ORDER}`,
      `/app/orders/${ORDER}`,
      `/app/orders/${ORDER}`,
    ]);
  });

  it("has nowhere to go for a job notification without its job", () => {
    expect(notificationHref("job_selling", null)).toBeNull();
    expect(notificationHref("payouts_active", null)).toBe("/app/settings/payouts");
    expect(notificationHref("order_paid", null, null)).toBeNull();
  });
});
