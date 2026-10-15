import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardQrPayload, photoKey, verifyWorkerRequest } from "@daybell/core";
import { localPhotoStorage, type PhotoStorage } from "@daybell/storage";
import type { SQSEvent } from "aws-lambda";
import QRCode from "qrcode";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configFromEnv,
  createHandler,
  kmsDataKey,
  photoIdsFromMessage,
  photoTasksFromMessage,
  secretsFromJson,
  type WorkerConfig,
} from "./worker";

const ids = {
  studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
  photoId: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
};
const BUCKET = "daybell-staging-ca-photos";
/** zxing's reader from the pipeline's node_modules; the Lambda passes the copy next to its bundle (ADR 0018). */
const qrWasmFile = createRequire(
  join(__dirname, "../../../packages/image-pipeline/package.json"),
).resolve("zxing-wasm/reader/zxing_reader.wasm");
const SECRET = "w".repeat(40);
const config: WorkerConfig = {
  callbackBaseUrl: "https://daybell-git-main-artona-tech-team.vercel.app",
  secret: SECRET,
  protectionBypass: "bypass-token",
  region: "ca",
  bucket: BUCKET,
};

const s3Event = (key: string, bucket = BUCKET) =>
  JSON.stringify({
    Records: [{ eventSource: "aws:s3", s3: { bucket: { name: bucket }, object: { key } } }],
  });
const sqs = (...bodies: string[]): SQSEvent =>
  ({ Records: bodies.map((body, i) => ({ messageId: `m${i}`, body })) }) as unknown as SQSEvent;

describe("photoIdsFromMessage", () => {
  it("reads the photo from an S3 event about an original, in its own bucket only", () => {
    expect(photoIdsFromMessage(s3Event(photoKey(ids, "original")), BUCKET)).toEqual([ids.photoId]);
    expect(photoIdsFromMessage(s3Event(photoKey(ids, "thumb.webp")), BUCKET)).toEqual([]);
    expect(photoIdsFromMessage(s3Event(photoKey(ids, "original"), "other"), BUCKET)).toEqual([]);
    expect(photoIdsFromMessage(s3Event("Maya Johnson.jpg"), BUCKET)).toEqual([]);
  });

  it("reads a retry from the API, and ignores test events and junk", () => {
    expect(photoIdsFromMessage(JSON.stringify({ photoId: ids.photoId }), BUCKET)).toEqual([
      ids.photoId,
    ]);
    expect(photoIdsFromMessage(JSON.stringify({ photoId: "../x" }), BUCKET)).toEqual([]);
    expect(photoIdsFromMessage(JSON.stringify({ Event: "s3:TestEvent" }), BUCKET)).toEqual([]);
    expect(photoIdsFromMessage("not json", BUCKET)).toEqual([]);
  });
});

describe("photoTasksFromMessage (ADR 0023)", () => {
  it("processes S3's originals and the API's retries, and makes only the download when asked", () => {
    expect(photoTasksFromMessage(s3Event(photoKey(ids, "original")), BUCKET)).toEqual([
      { photoId: ids.photoId, make: "process" },
    ]);
    expect(photoTasksFromMessage(JSON.stringify({ photoId: ids.photoId }), BUCKET)).toEqual([
      { photoId: ids.photoId, make: "process" },
    ]);
    expect(
      photoTasksFromMessage(JSON.stringify({ photoId: ids.photoId, make: "download" }), BUCKET),
    ).toEqual([{ photoId: ids.photoId, make: "download" }]);
    // The large view's DRM clip (ADR 0034, B6): the same queue, ids only.
    expect(
      photoTasksFromMessage(JSON.stringify({ photoId: ids.photoId, make: "drm" }), BUCKET),
    ).toEqual([{ photoId: ids.photoId, make: "drm" }]);
    // Anything else asks for nothing (never a guess at what was meant).
    expect(
      photoTasksFromMessage(JSON.stringify({ photoId: ids.photoId, make: "delete" }), BUCKET),
    ).toEqual([]);
    // A download.jpg or a DRM clip landing in S3 is not an original.
    expect(photoTasksFromMessage(s3Event(photoKey(ids, "download.jpg")), BUCKET)).toEqual([]);
    expect(photoTasksFromMessage(s3Event(photoKey(ids, "drm.mp4")), BUCKET)).toEqual([]);
  });
});

describe("configFromEnv and the secret", () => {
  const ARN =
    "arn:aws:secretsmanager:ca-central-1:123456789012:secret:daybell-staging-ca-image-worker-AbCdEf";
  const env = {
    DATA_REGION: "ca",
    AWS_REGION: "ca-central-1",
    PHOTO_WORKER_SECRETS_ARN: ARN,
    CALLBACK_BASE_URL: "https://example.vercel.app/",
    PHOTO_BUCKET: BUCKET,
  };
  it("reads its settings, with no secret in the environment", () => {
    expect(configFromEnv(env)).toEqual({
      callbackBaseUrl: "https://example.vercel.app",
      region: "ca",
      bucket: BUCKET,
      secretArn: ARN,
      drmKmsKeyArn: null,
    });
  });
  it("reads the DRM key's ARN when set, in ca-central-1 only (ADR 0034)", () => {
    const key = "arn:aws:kms:ca-central-1:123456789012:alias/daybell-staging-ca-drm";
    expect(configFromEnv({ ...env, DRM_KMS_KEY_ARN: key }).drmKmsKeyArn).toBe(key);
    expect(() =>
      configFromEnv({ ...env, DRM_KMS_KEY_ARN: key.replace("ca-central-1", "us-east-1") }),
    ).toThrow(/^DRM_KMS_KEY_ARN must be a KMS key or alias ARN in ca-central-1$/);
  });
  it("runs only in Canada for Canadian data (D113), and names what's wrong, never a value", () => {
    expect(() => configFromEnv({ ...env, AWS_REGION: "us-east-1" })).toThrow(/^AWS_REGION must be/);
    expect(() => configFromEnv({ ...env, DATA_REGION: "us" })).toThrow(/^DATA_REGION must be ca$/);
    expect(() =>
      configFromEnv({ ...env, PHOTO_WORKER_SECRETS_ARN: ARN.replace("ca-central-1", "us-east-1") }),
    ).toThrow(/in ca-central-1$/);
    expect(() => configFromEnv({ ...env, CALLBACK_BASE_URL: "http://x" })).toThrow(/https/);
    expect(() => configFromEnv({ ...env, PHOTO_BUCKET: "" })).toThrow(/^PHOTO_BUCKET is not set$/);
  });
  it("reads the signing secret and Vercel's bypass from the secret's JSON, refusing a short one by name", () => {
    expect(secretsFromJson(JSON.stringify({ photoWorkerSecret: SECRET }))).toEqual({
      secret: SECRET,
    });
    expect(
      secretsFromJson(JSON.stringify({ photoWorkerSecret: SECRET, vercelProtectionBypass: "b" })),
    ).toEqual({ secret: SECRET, protectionBypass: "b" });
    for (const bad of [
      "not json",
      JSON.stringify({ photoWorkerSecret: "short-secret" }),
      undefined,
    ]) {
      try {
        secretsFromJson(bad);
        throw new Error("accepted");
      } catch (e) {
        expect(String(e)).not.toContain("short-secret");
        expect(String(e)).not.toContain("accepted");
      }
    }
  });
});

describe("the Lambda handler (S3 and the API faked)", () => {
  let root: string;
  let storage: PhotoStorage;
  let original: Uint8Array;
  let status = "processing";
  let drmFields: Record<string, unknown> = {};
  const reports: unknown[] = [];

  /** The API: checks every call's signature like the internal routes do, and answers. */
  const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const headers = init?.headers as Record<string, string>;
    const body = (init?.body as string | undefined) ?? "";
    const ok = await verifyWorkerRequest([SECRET], headers["Daybell-Signature"] ?? null, {
      method: init?.method ?? "GET",
      path: u.pathname,
      region: headers["Daybell-Region"] ?? "",
      body,
    });
    if (!ok) return new Response("{}", { status: 401 });
    if (headers["x-vercel-protection-bypass"] !== "bypass-token")
      return new Response("{}", { status: 403 });
    if (init?.method === "POST") {
      reports.push(JSON.parse(body));
      return Response.json({ recorded: true });
    }
    return Response.json({
      photo: {
        id: ids.photoId,
        studioId: ids.studioId,
        jobId: ids.jobId,
        status,
        sha256: createHash("sha256").update(original).digest("hex"),
        byteSize: original.length,
        attempt: 2,
        studioName: "North Peak",
        ...drmFields,
      },
    });
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "daybell-worker-"));
    storage = localPhotoStorage({ root, secret: new Uint8Array(32) });
    original = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#468" } })
      .jpeg()
      .toBuffer();
    await storage.put(photoKey(ids, "original"), original, { contentType: "image/jpeg" });
    status = "processing";
    drmFields = {};
    reports.length = 0;
    fetchFake.mockClear();
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("makes the previews and reports the result over signed calls", async () => {
    const logs: unknown[][] = [];
    const handler = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: fetchFake as typeof fetch,
      log: (...args) => void logs.push(args),
    });
    expect(await handler(sqs(s3Event(photoKey(ids, "original"))))).toEqual({
      batchItemFailures: [],
    });
    expect(reports).toEqual([
      {
        status: "ready",
        width: 900,
        height: 600,
        capturedAt: null,
        qr: { kind: "none" },
        attempt: 2,
      },
    ]);
    for (const variant of ["thumb.webp", "view.webp", "proof-thumb.webp", "proof.webp"] as const)
      expect(await storage.head(photoKey(ids, variant))).not.toBeNull();
    // Never the paid download while processing: only a sold photo gets one (security review N1).
    expect(await storage.head(photoKey(ids, "download.jpg"))).toBeNull();
    expect(fetchFake.mock.calls.map(([url]) => String(url))).toEqual([
      `${config.callbackBaseUrl}/api/v1/internal/photo-worker/photos/${ids.photoId}`,
      `${config.callbackBaseUrl}/api/v1/internal/photo-worker/photos/${ids.photoId}/result`,
    ]);
    expect(logs).toEqual([["photo_ready", ids.photoId]]);
  });

  it("makes a sold photo's download when the API asks (lazily, ADR 0023)", async () => {
    status = "ready";
    const logs: unknown[][] = [];
    const handler = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: fetchFake as typeof fetch,
      log: (...args) => void logs.push(args),
    });
    expect(await handler(sqs(JSON.stringify({ photoId: ids.photoId, make: "download" })))).toEqual({
      batchItemFailures: [],
    });
    expect(await storage.head(photoKey(ids, "download.jpg"))).not.toBeNull();
    // Only the download: no previews remade and nothing reported.
    expect(await storage.head(photoKey(ids, "thumb.webp"))).toBeNull();
    expect(reports).toEqual([]);
    expect(logs).toEqual([["download_ready", ids.photoId]]);
  });

  it("packages a photo's large view for DRM when the API asks, reporting only the wrapped key (ADR 0034)", async () => {
    status = "ready";
    drmFields = { drmStatus: "requested", drmAttempt: 3 };
    const proof = await sharp({
      create: { width: 320, height: 213, channels: 3, background: "#468" },
    })
      .webp()
      .toBuffer();
    await storage.put(photoKey(ids, "proof.webp"), proof, { contentType: "image/webp" });
    const plaintext = new Uint8Array(16).fill(7);
    const ARN = "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
    const logs: unknown[][] = [];
    const packageClip = vi.fn(async (frame: { width: number; height: number }) => ({
      files: {
        "drm.mp4": new Uint8Array(10),
        "drm.mpd": new Uint8Array(1),
        "drm.m3u8": new Uint8Array(1),
        "drm-video.m3u8": new Uint8Array(1),
      },
      width: frame.width,
      height: frame.height,
    }));
    const handler = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: fetchFake as typeof fetch,
      log: (...args) => void logs.push(args),
      drm: {
        dataKey: async () => ({ plaintext, wrapped: new Uint8Array([1, 2, 3]), kmsKeyArn: ARN }),
        packageClip,
      },
    });
    expect(await handler(sqs(JSON.stringify({ photoId: ids.photoId, make: "drm" })))).toEqual({
      batchItemFailures: [],
    });
    for (const variant of ["drm.mp4", "drm.mpd", "drm.m3u8", "drm-video.m3u8"] as const)
      expect(await storage.head(photoKey(ids, variant))).not.toBeNull();
    expect(fetchFake.mock.calls.map(([url]) => String(url)).at(-1)).toBe(
      `${config.callbackBaseUrl}/api/v1/internal/photo-worker/photos/${ids.photoId}/drm`,
    );
    expect(reports).toEqual([
      {
        status: "ready",
        attempt: 3,
        keyId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        wrappedKey: "AQID",
        kmsKeyArn: ARN,
        width: 320,
        height: 212,
        bytes: 10,
      },
    ]);
    expect([...plaintext].every((b) => b === 0)).toBe(true);
    expect(logs).toEqual([["drm_ready", ids.photoId]]);
  });

  it("hands a DRM task back to SQS where DRM isn't set up (no DRM_KMS_KEY_ARN)", async () => {
    status = "ready";
    drmFields = { drmStatus: "requested", drmAttempt: 1 };
    const logs: unknown[][] = [];
    const handler = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: fetchFake as typeof fetch,
      log: (...args) => void logs.push(args),
    });
    expect(await handler(sqs(JSON.stringify({ photoId: ids.photoId, make: "drm" })))).toEqual({
      batchItemFailures: [{ itemIdentifier: "m0" }],
    });
    expect(logs).toEqual([["photo_error", ids.photoId, "DrmNotConfigured"]]);
    expect(reports).toEqual([]);
  });

  it("acknowledges a repeated message without doing the work again", async () => {
    status = "ready";
    const handler = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: fetchFake as typeof fetch,
      log: () => {},
    });
    expect(await handler(sqs(s3Event(photoKey(ids, "original"))))).toEqual({
      batchItemFailures: [],
    });
    expect(reports).toEqual([]);
    expect(await storage.head(photoKey(ids, "thumb.webp"))).toBeNull();
  });

  it("hands a message back to SQS when the API can't be reached, logging only the id and the error's name", async () => {
    const logs: unknown[][] = [];
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed for https://secret.example/?token=abc");
    });
    const handler = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: down as unknown as typeof fetch,
      log: (...args) => void logs.push(args),
    });
    expect(await handler(sqs(JSON.stringify({ photoId: ids.photoId }), "junk"))).toEqual({
      batchItemFailures: [{ itemIdentifier: "m0" }],
    });
    expect(logs).toEqual([
      ["photo_error", ids.photoId, "TypeError"],
      ["message_ignored", "m1"],
    ]);
  });

  it("hands a photo still uploading back to the queue after a few short checks (review CR1)", async () => {
    status = "uploading";
    const sleep = vi.fn(async (_ms: number) => {});
    const handler = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: fetchFake as typeof fetch,
      log: () => {},
      sleep,
    });
    expect(await handler(sqs(s3Event(photoKey(ids, "original"))))).toEqual({
      batchItemFailures: [{ itemIdentifier: "m0" }],
    });
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(reports).toEqual([]);
  });

  it("treats only the API's own not_found as a missing photo; any other 404 is tried again (review CR8)", async () => {
    const answer = (body: string) =>
      vi.fn(
        async () =>
          new Response(body, { status: 404, headers: { "content-type": "application/json" } }),
      );
    const gone = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: answer('{"error":{"code":"not_found","message":"x"}}') as unknown as typeof fetch,
      log: () => {},
    });
    expect(await gone(sqs(s3Event(photoKey(ids, "original"))))).toEqual({ batchItemFailures: [] });
    const proxy = createHandler({
      qrWasmFile,
      config,
      storage,
      fetch: answer("<html>Not Found</html>") as unknown as typeof fetch,
      log: () => {},
    });
    expect((await proxy(sqs(s3Event(photoKey(ids, "original"))))).batchItemFailures).toHaveLength(
      1,
    );
  });

  it("reads a photo's QR card and sends the code only in the signed body, never in a log or a URL (ADR 0018)", async () => {
    const code = "0123456789ABCDEFGHJK";
    const card = await QRCode.toBuffer(cardQrPayload(code), { margin: 4, width: 300 });
    original = await sharp({
      create: { width: 6000, height: 4000, channels: 3, background: "#5c6e80" },
    })
      .composite([{ input: card, left: 2600, top: 2300 }])
      .jpeg()
      .toBuffer();
    await storage.put(photoKey(ids, "original"), original, { contentType: "image/jpeg" });
    const logs: unknown[][] = [];
    const consoleLines: unknown[][] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args) => void consoleLines.push(args)),
    );
    try {
      const handler = createHandler({
        qrWasmFile,
        config,
        storage,
        fetch: fetchFake as typeof fetch,
        log: (...args) => void logs.push(args),
      });
      expect(await handler(sqs(s3Event(photoKey(ids, "original"))))).toEqual({
        batchItemFailures: [],
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(reports).toEqual([
      {
        status: "ready",
        width: 6000,
        height: 4000,
        capturedAt: null,
        qr: { kind: "card", cardCode: code },
        attempt: 2,
      },
    ]);
    expect(logs).toEqual([["photo_ready", ids.photoId]]);
    expect(JSON.stringify([logs, consoleLines])).not.toContain(code);
    for (const [url, init] of fetchFake.mock.calls) {
      expect(String(url)).not.toContain(code);
      expect(JSON.stringify((init as RequestInit | undefined)?.headers ?? {})).not.toContain(code);
    }
  }, 30_000);

  it("refuses to trust an API that rejects its signature", async () => {
    const handler = createHandler({
      qrWasmFile,
      config: { ...config, secret: "x".repeat(40) },
      storage,
      fetch: fetchFake as typeof fetch,
      log: () => {},
    });
    expect((await handler(sqs(s3Event(photoKey(ids, "original"))))).batchItemFailures).toHaveLength(
      1,
    );
  });
});

describe("kmsDataKey (B2, B4)", () => {
  const ARN = "arn:aws:kms:ca-central-1:123456789012:alias/daybell-staging-ca-drm";
  const context = {
    studio: ids.studioId,
    photo: ids.photoId,
    key: "2b0e6a4c-9f6e-4f0a-8d2b-3c4d5e6f7a8b",
  };
  it("asks for 16 bytes on the DRM key, bound to the photo by the encryption context", async () => {
    const send = vi.fn(async () => ({
      Plaintext: new Uint8Array(16),
      CiphertextBlob: new Uint8Array([5]),
      KeyId: "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab",
    }));
    const key = await kmsDataKey({ send }, ARN, (input) => ({ input }))(context);
    expect(send).toHaveBeenCalledWith({
      input: { KeyId: ARN, NumberOfBytes: 16, EncryptionContext: context },
    });
    expect(key.kmsKeyArn).toMatch(/:key\//);
    expect(key.wrapped).toEqual(new Uint8Array([5]));
  });

  it("refuses an answer without a 16-byte key, a wrapped copy and the key's ARN", async () => {
    for (const answer of [
      { Plaintext: new Uint8Array(32), CiphertextBlob: new Uint8Array([1]), KeyId: "k" },
      { Plaintext: new Uint8Array(16), KeyId: "k" },
      { Plaintext: new Uint8Array(16), CiphertextBlob: new Uint8Array([1]) },
    ])
      await expect(
        kmsDataKey({ send: async () => answer }, ARN, (input) => input)(context),
      ).rejects.toThrow(/^kms_data_key$/);
  });
});
