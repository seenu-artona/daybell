import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRM_BACKFILL_PER_RUN,
  DRM_MAX_REQUESTS,
  DRM_RETRY_AFTER_MINUTES,
  SHOP_DRM_TOKENS_PER_DAY,
  SHOP_DRM_TOKENS_PER_MINUTE,
} from "@daybell/core";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./routes";
import { fieldErrors, shopDrmManifestQuery, workerDrmResultInput } from "./schemas";
import { SHOP_CONFLICTS, shopDrmTokenResponse, shopPhoto } from "./types";

// DRM in the parent shop's large view (D158; ADR 0034): the contracts agree with the migration.
const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261018000000_shop_drm.sql"),
  "utf8",
);
const errors = (r: { success: boolean; error?: unknown }) =>
  r.success ? {} : fieldErrors(r.error as Parameters<typeof fieldErrors>[0]);

describe("the shop's DRM matches the database", () => {
  it("names every refusal the functions raise", () => {
    const raised = new Set(
      [...sql.matchAll(/raise exception '([a-z_]+)' using errcode = 'P0001'/g)].map((m) => m[1]),
    );
    expect([...raised].sort()).toEqual(
      ["drm_unavailable", "platform_settings_missing", "region_unavailable"].sort(),
    );
    expect(SHOP_CONFLICTS.drmUnavailable).toBe("shop.drmUnavailable");
  });

  it("has the same token limits, retry rules and batch size", () => {
    expect(sql).toContain(`v_rate.minute_hits >= ${SHOP_DRM_TOKENS_PER_MINUTE} then`);
    expect(sql).toContain(`v_rate.day_hits >= ${SHOP_DRM_TOKENS_PER_DAY} then`);
    expect(sql).toContain(`least(greatest(coalesce(p_limit, 0), 0), ${DRM_BACKFILL_PER_RUN})`);
    expect(
      sql.match(new RegExp(`interval '${DRM_RETRY_AFTER_MINUTES} minutes'`, "g")),
    ).toHaveLength(2);
    expect(sql).toContain(`x.drm_requests >= ${DRM_MAX_REQUESTS}`);
    expect(sql).toContain(`x.drm_requests < ${DRM_MAX_REQUESTS}`);
  });

  it("never grants anything to browsers, and keeps the switch from the API", () => {
    expect(sql).not.toMatch(/grant [^;]* to (anon|authenticated)/);
    expect(sql).toContain(
      "revoke all on function public.set_shop_drm(boolean, text) from service_role;",
    );
  });
});

describe("DRM contracts", () => {
  it("every gallery photo says whether its large view is protected", () => {
    expect(Object.keys(shopPhoto.shape)).toContain("drm");
  });

  it("a token is a token and its expiry: no ids of any kind", () => {
    expect(Object.keys(shopDrmTokenResponse.shape).sort()).toEqual(["expiresAt", "token"]);
  });

  it("a manifest is asked for in one of three formats", () => {
    expect(shopDrmManifestQuery.parse({ format: "dash" })).toEqual({ format: "dash" });
    expect(errors(shopDrmManifestQuery.safeParse({ format: "smooth" }))).toEqual({
      format: "validation.invalid",
    });
  });

  it("the worker reports a wrapped key from ca-central-1 only, never more than fits 4 KB", () => {
    const ok = {
      status: "ready",
      attempt: 1,
      keyId: "2b0e6a4c-9f6e-4f0a-8d2b-3c4d5e6f7a8b",
      wrappedKey: Buffer.alloc(184, 1).toString("base64"),
      kmsKeyArn: "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab",
      width: 1600,
      height: 1066,
      bytes: 60000,
    };
    expect(workerDrmResultInput.safeParse(ok).success).toBe(true);
    expect(JSON.stringify(ok).length).toBeLessThan(1024);
    expect(
      workerDrmResultInput.safeParse({
        ...ok,
        kmsKeyArn: ok.kmsKeyArn.replace("ca-central-1", "us-east-1"),
      }).success,
    ).toBe(false);
    expect(workerDrmResultInput.safeParse({ ...ok, wrappedKey: "x".repeat(2000) }).success).toBe(
      false,
    );
    expect(
      workerDrmResultInput.safeParse({ status: "failed", attempt: 1, reason: "unreadable" })
        .success,
    ).toBe(true);
    expect(
      workerDrmResultInput.safeParse({ status: "failed", attempt: 1, reason: "other" }).success,
    ).toBe(false);
  });

  it("the shop's DRM routes are parents' and internal routes, documented", () => {
    const drm = ROUTES.filter((r) => r.path.includes("/drm"));
    expect(drm.map((r) => `${r.method} ${r.path} ${r.access}`).sort()).toEqual(
      [
        "GET /shop/drm parent",
        "GET /shop/drm/fairplay-certificate parent",
        "GET /shop/children/{childId}/photos/{photoId}/drm-manifest parent",
        "POST /shop/children/{childId}/photos/{photoId}/drm-token parent",
        "POST /internal/photo-worker/photos/{id}/drm internal",
        "POST /dev/drm-test/token owner-admin",
      ].sort(),
    );
  });
});
