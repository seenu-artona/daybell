import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JOB_STATUSES,
  MAX_CLOSING_DAYS,
  MAX_NOTIFICATIONS_PER_READ,
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_KINDS,
  SELL_BLOCKER_DB_KEYS,
  SELL_CHECKLIST,
} from "@daybell/core";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./routes";
import { fieldErrors, jobListQuery, jobPatch, markNotificationsReadInput } from "./schemas";
import { ACTIVITY_TYPES, JOB_CONFLICTS, SELL_BLOCKER_FIELDS } from "./types";

const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261012500000_going_live.sql"),
  "utf8",
);
// Step 11 adds the order kinds in their own migration and replaces app.notification_audience (ADR 0024).
const enumsSql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261013100000_orders_enums.sql"),
  "utf8",
);
const ordersSql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261013100100_orders_and_refunds.sql"),
  "utf8",
);
const errors = (r: { success: boolean; error?: unknown }) =>
  r.success ? {} : fieldErrors(r.error as Parameters<typeof fieldErrors>[0]);

describe("going live matches the database (ADR 0021)", () => {
  it("has the same notification kinds", () => {
    const kinds = [
      ...(sql.match(/notification_kind as enum \(([^)]*)\)/)?.[1] ?? "").matchAll(/'(\w+)'/g),
      ...enumsSql.matchAll(/alter type public\.notification_kind add value '(\w+)'/g),
    ].map((m) => m[1]);
    expect(kinds).toEqual([...NOTIFICATION_KINDS]);
  });

  it("has the same audience per kind as app.notification_audience", () => {
    // The latest definition: step 11's.
    const body = ordersSql.slice(ordersSql.indexOf("function app.notification_audience"));
    for (const kind of NOTIFICATION_KINDS) {
      const roles = NOTIFICATION_AUDIENCE[kind].join(",");
      const explicit = body.match(new RegExp(`when '${kind}' then '\\{([^}]*)\\}'`))?.[1];
      // The CASE's last branch (else) is the photo kinds' audience.
      const fallback = body.match(/else '\{([^}]*)\}'/)?.[1];
      expect(explicit ?? fallback, kind).toBe(roles);
    }
  });

  it("names the blockers the way start_selling does, in the dialog's order", () => {
    for (const key of SELL_CHECKLIST)
      expect(sql).toContain(`array_append(v_out, '${SELL_BLOCKER_DB_KEYS[key]}')`);
    expect(Object.keys(SELL_BLOCKER_FIELDS)).toEqual([...SELL_CHECKLIST]);
  });

  it("has the same closing date bound and statuses", () => {
    expect(sql).toContain(`now() + interval '${MAX_CLOSING_DAYS} days'`);
    expect(JOB_STATUSES).toEqual(["draft", "selling", "closed"]);
  });
});

describe("going-live schemas", () => {
  it("takes a closing date with an offset, or null to remove it", () => {
    expect(jobPatch.parse({ closesAt: "2026-11-21T05:00:00.000Z" })).toEqual({
      closesAt: "2026-11-21T05:00:00.000Z",
    });
    expect(jobPatch.parse({ closesAt: "2026-11-21T00:00:00-05:00" }).closesAt).toBe(
      "2026-11-21T00:00:00-05:00",
    );
    expect(jobPatch.parse({ closesAt: null })).toEqual({ closesAt: null });
    for (const closesAt of ["2026-11-21", "2026-11-21T00:00:00", "tomorrow", 5])
      expect(errors(jobPatch.safeParse({ closesAt }))).toEqual({ closesAt: "validation.closesAt" });
  });

  it("never takes a status in a job patch", () => {
    expect(errors(jobPatch.safeParse({ status: "selling" }))).toEqual({
      form: "validation.unknownField",
    });
  });

  it("filters the jobs list by status", () => {
    expect(jobListQuery.parse({ status: "selling" }).status).toBe("selling");
    expect(jobListQuery.parse({}).status).toBeUndefined();
    expect(jobListQuery.safeParse({ status: "live" }).success).toBe(false);
  });

  it("marks 1 to 100 notifications read, by id only", () => {
    const id = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
    expect(markNotificationsReadInput.parse({ ids: [id] })).toEqual({ ids: [id] });
    expect(markNotificationsReadInput.safeParse({ ids: [] }).success).toBe(false);
    expect(
      markNotificationsReadInput.safeParse({
        ids: Array.from({ length: MAX_NOTIFICATIONS_PER_READ + 1 }, () => id),
      }).success,
    ).toBe(false);
    expect(markNotificationsReadInput.safeParse({ ids: ["1"] }).success).toBe(false);
    expect(markNotificationsReadInput.safeParse({ ids: [id], all: true }).success).toBe(false);
  });
});

describe("going-live routes and words", () => {
  it("describes every new route with who may call it", () => {
    const access = Object.fromEntries(ROUTES.map((r) => [`${r.method} ${r.path}`, r.access]));
    expect(access).toMatchObject({
      "POST /jobs/{id}/start-selling": "owner-admin",
      "POST /jobs/{id}/close": "owner-admin",
      "POST /jobs/{id}/reopen": "owner-admin",
      "GET /notifications": "signed-in",
      "GET /notifications/unread-count": "signed-in",
      "POST /notifications/read": "signed-in",
      "POST /notifications/read-all": "signed-in",
      "GET /internal/cron/jobs": "internal",
    });
    const start = ROUTES.find((r) => r.path === "/jobs/{id}/start-selling");
    expect(start?.description).toMatch(/atomically/);
  });

  it("shows the shop opening and closing in the activity log", () => {
    expect(ACTIVITY_TYPES).toContain("job.selling");
    expect(ACTIVITY_TYPES).toContain("job.closed");
    expect(Object.values(JOB_CONFLICTS).every((k) => k.startsWith("jobs."))).toBe(true);
  });

  it("names every refusal go_live raises (orchestrator's M3: closes_at_passed)", () => {
    expect(sql).toContain("raise exception 'closes_at_passed'");
    expect(JOB_CONFLICTS.closesAtPassed).toBe("jobs.closesAtPassed");
  });
});
