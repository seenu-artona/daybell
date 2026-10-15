import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The parent shop's DRM routes (D158; ADR 0034): parents' sessions only, counted before anything else; the database
// decides the entitlement (every photo a parent may not see, whatever the reason, is "not found", like a missing one);
// manifests come from S3 with the clip signed for 10 minutes; tokens carry one photo's key, unwrapped by KMS with the
// encryption context {studio, photo, key} and zeroed after signing; refusals are 401, 404, 409 or 429 with Retry-After;
// answers are never cached; Canadian work is pinned to Montréal; and nothing about a key, a token or a person is ever
// logged. The database, S3 and KMS are faked.
vi.mock("server-only", () => ({}));
const { rpc, signed, stored, kms } = vi.hoisted(() => ({
  rpc: vi.fn(),
  signed: [] as { key: string; expiresIn: number }[],
  stored: new Map<string, string>(),
  kms: {
    decrypts: [] as Record<string, unknown>[],
    plaintexts: [] as Uint8Array[],
    fail: false,
    key: new Uint8Array(16),
  },
}));
vi.mock("@/lib/supabase/service", () => ({ shopRpc: rpc }));
vi.mock("@/lib/photo-storage", () => ({
  photoStorage: () => ({
    presignGet: async (key: string, { expiresIn }: { expiresIn: number }) => {
      signed.push({ key, expiresIn });
      return `https://bucket.s3.ca-central-1.amazonaws.com/${key}?X-Amz-Expires=${expiresIn}&X-Amz-Signature=s`;
    },
    get: async (key: string) => {
      const text = stored.get(key);
      if (text === undefined) {
        const { StorageError } = await import("@daybell/storage");
        throw new StorageError("not_found");
      }
      return new TextEncoder().encode(text);
    },
  }),
}));
vi.mock("@vercel/oidc-aws-credentials-provider", () => ({
  awsCredentialsProvider: () => async () => ({}),
}));
vi.mock("@aws-sdk/client-kms", () => ({
  DecryptCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
  KMSClient: class {
    async send(command: { input: Record<string, unknown> }) {
      kms.decrypts.push(command.input);
      if (kms.fail)
        throw Object.assign(new Error("AccessDenied arn:aws:kms:… request id 123"), {
          name: "AccessDeniedException",
        });
      const plaintext = new Uint8Array(kms.key);
      kms.plaintexts.push(plaintext);
      return { Plaintext: plaintext };
    }
  },
}));
vi.mock("@daybell/config", async (original) => {
  const real = await original<typeof import("@daybell/config")>();
  const db = (region: string) => ({ region, url: "http://127.0.0.1:54321", publishableKey: "pk" });
  return { ...real, regionDatabase: db, availableRegions: () => [db("ca")] };
});

const key32 = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const COM_KEY = randomBytes(32);
const CERT = Buffer.concat([Buffer.from([0x30, 0x82]), randomBytes(900)]);
const ENV = {
  ACCESS_CODE_HMAC_KEY: key32(1),
  ACCESS_CODE_ENCRYPTION_KEY: key32(2),
  SHOP_THROTTLE_KEY: key32(3),
  SHOP_TRUST_XFF: "1",
  STORAGE_DRIVER: "s3",
  AWS_REGION: "ca-central-1",
  PHOTO_BUCKET_CA: "daybell-staging-ca-photos",
  PHOTO_QUEUE_URL_CA: "https://sqs.ca-central-1.amazonaws.com/123456789012/q",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/web",
  AWS_DOWNLOAD_ROLE_ARN: "arn:aws:iam::123456789012:role/downloads",
  AWS_DRM_ROLE_ARN: "arn:aws:iam::123456789012:role/drm",
  DRM_KMS_KEY_ARN_CA:
    "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab",
  SHOP_DRM_COM_KEY_ID: randomUUID(),
  SHOP_DRM_COM_KEY: COM_KEY.toString("base64"),
  SHOP_DRM_LICENSE_PREFIX: "daybell-shop",
  SHOP_DRM_FAIRPLAY_CERT: CERT.toString("base64"),
};
const stubAll = (env: Record<string, string>) => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
};
stubAll(ENV);

const { galleryId } = await import("@/lib/shop/session");
const { signDevice } = await import("@/lib/shop/throttle");

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const CHILD = "c0000000-0000-4000-8000-000000000001";
const PHOTO = "f0000000-0000-4000-8000-000000000001";
const KEY_ID = "2b0e6a4c-9f6e-4f0a-8d2b-3c4d5e6f7a8b";
const KMS_KEY = "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
const WRAPPED = Buffer.from("w".repeat(184)).toString("base64");
const TOKEN = "T".repeat(43);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DEVICE = signDevice("D".repeat(43), Math.floor(Date.now() / 1000));
const COOKIE = `daybell_shop=ca.${TOKEN}; daybell_device=${DEVICE}`;
const BASE = `http://localhost/api/v1/shop/children/${CHILD}/photos/${PHOTO}`;
const PREFIX = `${STUDIO}/${JOB}/${PHOTO}/drm/${"2b0e6a4c-9f6e-4f0a-8d2b-3c4d5e6f7a8b"}`;

/** Each shop function answers from `answer` (take_shop_request lets everything in). */
function database(
  answer: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown },
) {
  rpc.mockImplementation(async (_region: string, fn: string, args: Record<string, unknown>) => {
    if (fn === "take_shop_request") return { data: true, error: null };
    const a = answer(fn, args);
    return { data: a.data ?? null, error: a.error ?? null };
  });
}
const calls = (fn: string) => rpc.mock.calls.filter((c) => c[1] === fn);
const notFound = { error: { code: "P0002", message: "Photo not found" } };
const named = (message: string) => ({ error: { code: "P0001", message } });

const request = (method: string, url: string, headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "x-forwarded-for": "203.0.113.7", cookie: COOKIE, ...headers },
  });
const params = (childId = CHILD, photoId = PHOTO) => ({
  params: Promise.resolve({ childId, photoId }),
});

const routes = {
  config: async () => (await import("./shop/drm/route")).GET,
  certificate: async () => (await import("./shop/drm/fairplay-certificate/route")).GET,
  manifest: async () =>
    (await import("./shop/children/[childId]/photos/[photoId]/drm-manifest/route")).GET,
  token: async () =>
    (await import("./shop/children/[childId]/photos/[photoId]/drm-token/route")).POST,
};

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  signed.length = 0;
  stored.clear();
  kms.decrypts.length = 0;
  kms.plaintexts.length = 0;
  kms.fail = false;
  kms.key = new Uint8Array(randomBytes(16));
  logs = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  rpc.mockReset();
  vi.unstubAllEnvs();
  stubAll(ENV);
  vi.restoreAllMocks();
});

describe("GET /shop/drm", () => {
  it("is on when the gallery's database has the switch on and DRM is set up here", async () => {
    database((fn) => (fn === "shop_drm_enabled_for" ? { data: true } : {}));
    const res = await (await routes.config())(request("GET", "http://localhost/api/v1/shop/drm"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      enabled: true,
      licenseUrls: {
        widevine: "https://daybell-shop.drm-widevine-licensing.axprod.net/AcquireLicense",
        playready: "https://daybell-shop.drm-playready-licensing.axprod.net/AcquireLicense",
        fairplay: "https://daybell-shop.drm-fairplay-licensing.axprod.net/AcquireLicense",
      },
      fairplayCertificateUrl: "/api/v1/shop/drm/fairplay-certificate",
      codec: "avc1.640028",
    });
    expect(calls("shop_drm_enabled_for")).toHaveLength(1);
  });

  it("is off with the switch off (the default, C6)", async () => {
    database((fn) => (fn === "shop_drm_enabled_for" ? { data: false } : {}));
    const res = await (await routes.config())(request("GET", "http://localhost/api/v1/shop/drm"));
    expect(await res.json()).toEqual({
      enabled: false,
      licenseUrls: null,
      fairplayCertificateUrl: null,
      codec: "avc1.640028",
    });
  });

  it("is off where DRM isn't set up, without asking the database; FairPlay only with its certificate", async () => {
    database(() => ({ data: true }));
    for (const name of ["SHOP_DRM_COM_KEY_ID", "SHOP_DRM_COM_KEY", "SHOP_DRM_LICENSE_PREFIX"])
      vi.stubEnv(name, "");
    let res = await (await routes.config())(request("GET", "http://localhost/api/v1/shop/drm"));
    expect((await res.json()).enabled).toBe(false);
    expect(calls("shop_drm_enabled_for")).toHaveLength(0);
    stubAll(ENV);
    vi.stubEnv("SHOP_DRM_FAIRPLAY_CERT", "");
    res = await (await routes.config())(request("GET", "http://localhost/api/v1/shop/drm"));
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.licenseUrls.fairplay).toBeNull();
    expect(body.fairplayCertificateUrl).toBeNull();
  });

  it("turns off (never a parent-facing error) when a setting is malformed, logging its name only", async () => {
    database(() => ({ data: true }));
    vi.stubEnv("SHOP_DRM_COM_KEY", key32(9).slice(0, 10));
    const res = await (await routes.config())(request("GET", "http://localhost/api/v1/shop/drm"));
    expect((await res.json()).enabled).toBe(false);
    const error = logs[3] as ReturnType<typeof vi.spyOn>;
    expect(error.mock.calls).toEqual([
      ["shop_drm_misconfigured", "SHOP_DRM_COM_KEY must be 32 bytes, base64-encoded"],
    ]);
    error.mockClear();
  });

  it("is a parent's: no session, no answer", async () => {
    database(() => ({ data: true }));
    const res = await (await routes.config())(
      new Request("http://localhost/api/v1/shop/drm", {
        headers: { "x-forwarded-for": "203.0.113.7" },
      }),
    );
    expect(res.status).toBe(401);
    expect(calls("shop_drm_enabled_for")).toHaveLength(0);
  });
});

describe("GET /shop/drm/fairplay-certificate (C10)", () => {
  it("serves the certificate's bytes from this site", async () => {
    database(() => ({}));
    const res = await (await routes.certificate())(
      request("GET", "http://localhost/api/v1/shop/drm/fairplay-certificate"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(CERT)).toBe(true);
  });

  it("is not found without FairPlay, or without a session", async () => {
    database(() => ({}));
    vi.stubEnv("SHOP_DRM_FAIRPLAY_CERT", "");
    expect(
      (
        await (
          await routes.certificate()
        )(request("GET", "http://localhost/api/v1/shop/drm/fairplay-certificate"))
      ).status,
    ).toBe(404);
    stubAll(ENV);
    expect(
      (
        await (
          await routes.certificate()
        )(
          new Request("http://localhost/api/v1/shop/drm/fairplay-certificate", {
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
        )
      ).status,
    ).toBe(401);
  });
});

const MPD = `<?xml version="1.0"?>\n<MPD xmlns:cenc="urn:mpeg:cenc:2013"><Period><AdaptationSet><ContentProtection value="cbcs" cenc:default_KID="${KEY_ID}"/><Representation>\n<BaseURL>drm.mp4</BaseURL>\n</Representation></AdaptationSet></Period></MPD>\n`;
const MASTER = `#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.640028"\ndrm-video.m3u8\n`;
const MEDIA = `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="drm.mp4",BYTERANGE="1495@0"\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://${KEY_ID}",KEYFORMATVERSIONS="1",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:2.000,\n#EXT-X-BYTERANGE:60777@1539\ndrm.mp4\n#EXT-X-ENDLIST\n`;
const where = { data: { studio_id: STUDIO, job_id: JOB, photo_id: PHOTO, key_id: KEY_ID } };

describe("GET /shop/children/:childId/photos/:photoId/drm-manifest", () => {
  beforeEach(() => {
    stored.set(`${PREFIX}.mpd`, MPD);
    stored.set(`${PREFIX}.m3u8`, MASTER);
    stored.set(`${PREFIX}-video.m3u8`, MEDIA);
  });

  it("DASH: the clip signed for 10 minutes, & escaped, never cached", async () => {
    database((fn) => (fn === "shop_drm_photo" ? where : {}));
    const res = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=dash`),
      params(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/dash+xml");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain(
      `<BaseURL>https://bucket.s3.ca-central-1.amazonaws.com/${PREFIX}.mp4?X-Amz-Expires=600&amp;X-Amz-Signature=s</BaseURL>`,
    );
    expect(signed).toEqual([{ key: `${PREFIX}.mp4`, expiresIn: 600 }]);
    expect(calls("shop_drm_photo")[0]?.[2]).toEqual({
      p_session_hash: sha(TOKEN),
      p_child_id: CHILD,
      p_photo_id: PHOTO,
    });
  });

  it("HLS: the master's variant comes back here for the same gallery; the media playlist's clip is signed", async () => {
    database((fn) => (fn === "shop_drm_photo" ? where : {}));
    const master = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=hls`),
      params(),
    );
    expect(master.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(await master.text()).toContain(
      `\n/api/v1/shop/children/${CHILD}/photos/${PHOTO}/drm-manifest?format=hls-media&gallery=${galleryId(TOKEN)}\n`,
    );
    expect(signed).toEqual([]);
    const media = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=hls-media`),
      params(),
    );
    const text = await media.text();
    expect(text).toContain(
      `#EXT-X-MAP:URI="https://bucket.s3.ca-central-1.amazonaws.com/${PREFIX}.mp4?`,
    );
    expect(text).toContain(`URI="skd://${KEY_ID}"`);
    expect(text).not.toMatch(/^drm\.mp4$/m);
  });

  it("is not found for anything the parent may not see, as for a photo that doesn't exist (leaks, D96)", async () => {
    // The database decides: another studio's, another session's, a sibling's, another group's, a binned, flagged, card
    // or closed shop's photo are all P0002, exactly like a missing one (pgTAP 033).
    database((fn) => (fn === "shop_drm_photo" ? notFound : {}));
    const res = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=dash`),
      params(),
    );
    expect(res.status).toBe(404);
    expect(signed).toEqual([]);
    // Ids that aren't UUIDs never reach the database.
    rpc.mockClear();
    database(() => ({}));
    const bad = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=dash`),
      params("../x", PHOTO),
    );
    expect(bad.status).toBe(404);
    expect(calls("shop_drm_photo")).toHaveLength(0);
  });

  it("answers 409 shop.drmUnavailable while the view isn't protected, and 400 for another format", async () => {
    database((fn) => (fn === "shop_drm_photo" ? named("drm_unavailable") : {}));
    const res = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=dash`),
      params(),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.form).toBe("shop.drmUnavailable");
    const other = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=smooth`),
      params(),
    );
    expect(other.status).toBe(400);
    // Not set up here: 409 without asking the database.
    rpc.mockClear();
    database(() => where);
    vi.stubEnv("DRM_KMS_KEY_ARN_CA", "");
    const off = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=dash`),
      params(),
    );
    expect(off.status).toBe(409);
    expect(calls("shop_drm_photo")).toHaveLength(0);
  });

  it("serves only the files of the database's key, and refuses a manifest for any other key (review H1)", async () => {
    // Another run's files (drm/{other}.*) are never read: the database's key names the only files served.
    const other = "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    database((fn) => (fn === "shop_drm_photo" ? { data: { ...where.data, key_id: other } } : {}));
    const missing = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=dash`),
      params(),
    );
    expect(missing.status).toBe(409);
    // Its files exist, but its manifest names the other key: refused, never served.
    stored.set(`${STUDIO}/${JOB}/${PHOTO}/drm/${other}.mpd`, MPD);
    stored.set(`${STUDIO}/${JOB}/${PHOTO}/drm/${other}-video.m3u8`, MEDIA);
    for (const format of ["dash", "hls-media"]) {
      const res = await (await routes.manifest())(
        request("GET", `${BASE}/drm-manifest?format=${format}`),
        params(),
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error.fields.form).toBe("shop.drmUnavailable");
    }
    expect(signed.every((s) => s.key.includes(`/drm/${other}.mp4`))).toBe(true);
    const error = logs[3] as ReturnType<typeof vi.spyOn>;
    expect(error.mock.calls).toEqual([
      ["shop_drm_manifest_missing"],
      ["shop_drm_manifest_mismatch"],
      ["shop_drm_manifest_mismatch"],
    ]);
    error.mockClear();
  });

  it("counts in the DRM routes' own bucket, never the shop's (review: tester #4)", async () => {
    database((fn) => (fn === "shop_drm_photo" ? where : {}));
    await (await routes.manifest())(request("GET", `${BASE}/drm-manifest?format=dash`), params());
    const take = calls("take_shop_request")[0]?.[2] as Record<string, unknown>;
    expect(take.p_limit).toBe(300);
    expect(take.p_wide_limit).toBe(3000);
    // Not the shop's 120 and 1,200, and under keys of its own.
    const { budgetKeys } = await import("@/lib/shop/throttle");
    const req = request("GET", `${BASE}/drm-manifest?format=dash`);
    expect(take.p_ip_key).toBe(budgetKeys(req, "drm").networkKey);
    expect(take.p_ip_key).not.toBe(budgetKeys(req).networkKey);
  });

  it("needs a session (401) and the gallery it names", async () => {
    database(() => where);
    const res = await (await routes.manifest())(
      new Request(`${BASE}/drm-manifest?format=dash`, {
        headers: { "x-forwarded-for": "203.0.113.7" },
      }),
      params(),
    );
    expect(res.status).toBe(401);
    const other = await (await routes.manifest())(
      request("GET", `${BASE}/drm-manifest?format=dash&gallery=${"0".repeat(32)}`),
      params(),
    );
    expect(other.status).toBe(401);
    expect(calls("shop_drm_photo")).toHaveLength(0);
  });
});

const keyRow = {
  data: {
    studio_id: STUDIO,
    photo_id: PHOTO,
    key_id: KEY_ID,
    wrapped_key: WRAPPED,
    kms_key_arn: KMS_KEY,
  },
};
const decodeToken = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString());

describe("POST /shop/children/:childId/photos/:photoId/drm-token", () => {
  it("signs a 60-second token for the photo's key, unwrapped with its encryption context, then zeroed", async () => {
    database((fn) => (fn === "shop_drm_key" ? keyRow : {}));
    const contentKey = Buffer.from(kms.key);
    const res = await (await routes.token())(request("POST", `${BASE}/drm-token`), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);
    expect(kms.decrypts).toEqual([
      {
        KeyId: KMS_KEY,
        CiphertextBlob: Buffer.from(WRAPPED, "base64"),
        EncryptionContext: { studio: STUDIO, photo: PHOTO, key: KEY_ID },
      },
    ]);
    const payload = decodeToken(body.token);
    expect(payload.com_key_id).toBe(ENV.SHOP_DRM_COM_KEY_ID);
    const inline = payload.message.content_keys_source.inline;
    expect(inline).toHaveLength(1);
    expect(inline[0].id).toBe(KEY_ID);
    // The wrapped key Axinom gets unwraps, with the communication key, to exactly KMS's plaintext.
    const decipher = createDecipheriv(
      "aes-256-cbc",
      COM_KEY,
      Buffer.from(KEY_ID.replaceAll("-", ""), "hex"),
    );
    decipher.setAutoPadding(false);
    const back = Buffer.concat([
      decipher.update(Buffer.from(inline[0].encrypted_key, "base64")),
      decipher.final(),
    ]);
    expect(back.equals(contentKey)).toBe(true);
    // The plaintext KMS returned is zeroed once the token is signed.
    expect([...(kms.plaintexts[0] ?? [1])].every((b) => b === 0)).toBe(true);
    // No studio, child or photo id, no name, no code in the token.
    const text = JSON.stringify(payload);
    for (const id of [STUDIO, CHILD, PHOTO, JOB]) expect(text).not.toContain(id);
  });

  it("is not found for a photo the parent may not see, before any key is unwrapped (leaks, D96)", async () => {
    database((fn) => (fn === "shop_drm_key" ? notFound : {}));
    const res = await (await routes.token())(request("POST", `${BASE}/drm-token`), params());
    expect(res.status).toBe(404);
    expect(kms.decrypts).toEqual([]);
  });

  it("says when to try again past the gallery's budget, logging a fixed name only (C3)", async () => {
    database((fn) =>
      fn === "shop_drm_key" ? { data: { rate_limited: true, retry_after: 37 } } : {},
    );
    const res = await (await routes.token())(request("POST", `${BASE}/drm-token`), params());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("37");
    expect(kms.decrypts).toEqual([]);
    const warn = logs[2] as ReturnType<typeof vi.spyOn>;
    expect(warn.mock.calls).toEqual([["shop_drm_rate_limited"]]);
    warn.mockClear();
  });

  it("answers 409 while the view isn't protected, 401 without a session, 403 cross-site", async () => {
    database((fn) => (fn === "shop_drm_key" ? named("drm_unavailable") : {}));
    const res = await (await routes.token())(request("POST", `${BASE}/drm-token`), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.form).toBe("shop.drmUnavailable");
    database((fn) => (fn === "shop_drm_key" ? named("session_required") : {}));
    expect(
      (await (await routes.token())(request("POST", `${BASE}/drm-token`), params())).status,
    ).toBe(401);
    rpc.mockClear();
    database(() => keyRow);
    const cross = await (await routes.token())(
      request("POST", `${BASE}/drm-token`, { "sec-fetch-site": "cross-site" }),
      params(),
    );
    expect(cross.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a wrapped key from any KMS key but this environment's, before asking KMS (review L3)", async () => {
    database((fn) =>
      fn === "shop_drm_key"
        ? { data: { ...keyRow.data, kms_key_arn: KMS_KEY.replace("1234abcd", "9999abcd") } }
        : {},
    );
    const res = await (await routes.token())(request("POST", `${BASE}/drm-token`), params());
    expect(res.status).toBe(409);
    expect(kms.decrypts).toEqual([]);
    const error = logs[3] as ReturnType<typeof vi.spyOn>;
    expect(error.mock.calls).toEqual([["shop_drm_key_mismatch"]]);
    error.mockClear();
  });

  it("fails with a 500 when KMS refuses, logging the error's name only, never a key", async () => {
    database((fn) => (fn === "shop_drm_key" ? keyRow : {}));
    kms.fail = true;
    const res = await (await routes.token())(request("POST", `${BASE}/drm-token`), params());
    expect(res.status).toBe(500);
    const error = logs[3] as ReturnType<typeof vi.spyOn>;
    expect(error.mock.calls).toEqual([["shop_drm_unwrap_failed", "AccessDeniedException"]]);
    expect(JSON.stringify(error.mock.calls)).not.toContain(WRAPPED);
    error.mockClear();
  });
});

describe("the DRM routes' configuration (D113)", () => {
  it("run in Node, pinned to Montréal", async () => {
    for (const path of [
      "./shop/drm/route",
      "./shop/drm/fairplay-certificate/route",
      "./shop/children/[childId]/photos/[photoId]/drm-manifest/route",
      "./shop/children/[childId]/photos/[photoId]/drm-token/route",
      "./internal/photo-worker/photos/[id]/drm/route",
    ]) {
      const route = await import(/* @vite-ignore */ path);
      expect(route.runtime, path).toBe("nodejs");
      expect(route.preferredRegion, path).toBe("yul1");
    }
  });
});
