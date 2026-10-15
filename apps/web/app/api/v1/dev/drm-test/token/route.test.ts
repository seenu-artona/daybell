import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { ApiError } from "@daybell/api";
import { afterEach, describe, expect, it, vi } from "vitest";

// The DRM test page's token route (spike; D158; ADR 0032): off unless DRM_TEST_PAGE_ENABLED is true, and then not
// asking who is calling before the flag; signed-in owners and admins only; a token that verifies with the
// communication key; a named but value-free log line when it isn't set up; never the token or a key in a log; Montréal.
// Keys are made at run time; the session is faked.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const COM_KEY = randomBytes(32);
const CONTENT_KEY = randomBytes(16);
const COM_KEY_ID = randomUUID();
const KEY_ID = randomUUID();

function configure(over: Record<string, string> = {}) {
  const env: Record<string, string> = {
    DRM_TEST_PAGE_ENABLED: "true",
    AXINOM_COM_KEY_ID: COM_KEY_ID,
    AXINOM_COM_KEY: COM_KEY.toString("base64"),
    AXINOM_LICENSE_PREFIX: "tenant-1",
    AXINOM_FAIRPLAY_CERT_URL: "",
    DRM_TEST_KEY_ID: KEY_ID,
    DRM_TEST_CONTENT_KEY: CONTENT_KEY.toString("hex"),
    ...over,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

const as = (role: string) => ({
  supabase: {},
  userId: "u1",
  studio: { id: randomUUID(), name: "A", slug: "a", region: "ca", role },
});

async function call(headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/v1/dev/drm-test/token", { method: "POST", headers }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  scope.mockReset();
});

describe("POST /api/v1/dev/drm-test/token", () => {
  it.each([
    ["unset", ""],
    ["false", "false"],
    ["1", "1"],
  ])("is not found when the flag is %s, before asking who is calling", async (_name, value) => {
    configure({ DRM_TEST_PAGE_ENABLED: value });
    const res = await call();
    expect(res.status).toBe(404);
    expect(scope).not.toHaveBeenCalled();
  });

  it("refuses someone not signed in", async () => {
    configure();
    scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("not_signed_in");
  });

  it.each(["photographer", "staff"])("refuses a %s", async (role) => {
    configure();
    scope.mockResolvedValue(as(role));
    expect((await call()).status).toBe(403);
  });

  it("refuses a cross-site request", async () => {
    configure();
    scope.mockResolvedValue(as("owner"));
    expect((await call({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(scope).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])(
    "gives a %s a token that verifies, with Axinom's addresses",
    async (role) => {
      configure();
      scope.mockResolvedValue(as(role));
      const log = vi.spyOn(console, "error");
      const res = await call();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      const [header, payload, signature] = body.token.split(".");
      expect(createHmac("sha256", COM_KEY).update(`${header}.${payload}`).digest("base64url")).toBe(
        signature,
      );
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      expect(claims.com_key_id).toBe(COM_KEY_ID);
      expect(claims.message.content_keys_source.inline[0].id).toBe(KEY_ID);
      expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);
      expect(body.licenseUrls).toEqual({
        widevine: "https://tenant-1.drm-widevine-licensing.axprod.net/AcquireLicense",
        playready: "https://tenant-1.drm-playready-licensing.axprod.net/AcquireLicense",
        fairplay: null,
      });
      expect(body.fairplayCertificateUrl).toBeNull();
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("turns FairPlay on with its certificate address", async () => {
    configure({ AXINOM_FAIRPLAY_CERT_URL: "https://certs.example.test/fps.der" });
    scope.mockResolvedValue(as("owner"));
    const body = await (await call()).json();
    expect(body.licenseUrls.fairplay).toBe(
      "https://tenant-1.drm-fairplay-licensing.axprod.net/AcquireLicense",
    );
    expect(body.fairplayCertificateUrl).toBe("https://certs.example.test/fps.der");
  });

  it("names a missing setting in the log, never a value, and answers a named 409", async () => {
    configure({ DRM_TEST_CONTENT_KEY: "" });
    scope.mockResolvedValue(as("owner"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ setup: "drmTest.notConfigured" });
    expect(log).toHaveBeenCalledWith("drm_test_config", "DRM_TEST_CONTENT_KEY is not set");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(COM_KEY.toString("base64"));
    expect(logged).not.toContain(CONTENT_KEY.toString("hex"));
  });

  it("is pinned to Montréal on Node (D113)", async () => {
    const route = await import("./route");
    expect(route.preferredRegion).toBe("yul1");
    expect(route.runtime).toBe("nodejs");
  });
});
