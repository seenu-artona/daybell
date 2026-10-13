import { describe, expect, it } from "vitest";
import {
  hearsAbout,
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_KINDS,
  newNotifications,
  notificationTarget,
} from "./notifications";

const ROLES = ["owner", "admin", "photographer", "staff"] as const;

describe("notification audience (ADR 0021, call 4)", () => {
  it("tells everyone about the shop, owners and admins about payouts, photo people about photos", () => {
    const matrix = Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [kind, ROLES.filter((role) => hearsAbout(role, kind))]),
    );
    expect(matrix).toEqual({
      job_selling: ["owner", "admin", "photographer", "staff"],
      job_closed: ["owner", "admin", "photographer", "staff"],
      payouts_active: ["owner", "admin"],
      payouts_restricted: ["owner", "admin"],
      photos_failed: ["owner", "admin", "photographer"],
      tagging_ready: ["owner", "admin", "photographer"],
      // Orders (ADR 0024): who fulfils hears of a new order; who refunds, of a failed refund or a dispute.
      order_paid: ["owner", "admin", "staff"],
      refund_failed: ["owner", "admin"],
      dispute_opened: ["owner", "admin"],
    });
    expect(Object.keys(NOTIFICATION_AUDIENCE)).toEqual([...NOTIFICATION_KINDS]);
    expect(hearsAbout("outsider", "job_selling")).toBe(false);
  });

  it("leads each kind to where it is dealt with", () => {
    expect(NOTIFICATION_KINDS.map(notificationTarget)).toEqual([
      "jobOverview",
      "jobOverview",
      "payouts",
      "payouts",
      "jobFailedPhotos",
      "jobReview",
      "order",
      "order",
      "order",
    ]);
  });
});

describe("newNotifications (the bell's live region)", () => {
  it("announces only a rise, never the first count after the page loads", () => {
    expect(newNotifications(null, 5)).toBeNull();
    expect(newNotifications(2, 2)).toBeNull();
    expect(newNotifications(3, 0)).toBeNull();
    expect(newNotifications(0, 1)).toBe(1);
    expect(newNotifications(2, 5)).toBe(3);
  });
});
