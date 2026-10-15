import { ApiError } from "@daybell/api";
import { PART_BYTES, photoKey, signWorkerRequest } from "@daybell/core";
import { StorageError } from "@daybell/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Photo routes (ADR 0016): who may call them and in what order (the person and their role before the body; the
// region before any storage), another studio's batches and photos are simply not found (row-level security, faked
// here), uploads complete only from what storage has, and the internal routes accept only signed or cron requests.
vi.mock("server-only", () => ({}));
const { scope, writeRpc, systemRpc, storage, afterCallbacks, queueDrm } = vi.hoisted(() => ({
  afterCallbacks: [] as (() => Promise<void>)[],
  queueDrm: vi.fn(),
  scope: vi.fn(),
  writeRpc: vi.fn(),
  systemRpc: vi.fn(),
  storage: {
    createMultipart: vi.fn(),
    presignPart: vi.fn(),
    listParts: vi.fn(),
    complete: vi.fn(),
    abort: vi.fn(),
    head: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    presignGet: vi.fn(),
    deleteAllVersions: vi.fn(),
  },
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({ photoWriteRpc: writeRpc, photoSystemRpc: systemRpc }));
// Work after the response (tagging, ADR 0018) is collected here and run by the tests that look at it.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void afterCallbacks.push(fn),
}));
// The local stack's Canadian database is configured (read at import time in the real module).
vi.mock("@daybell/config", async (original) => ({
  ...(await original<typeof import("@daybell/config")>()),
  regionDatabase: (region: string) =>
    region === "ca" ? { region, url: "http://127.0.0.1:54321", publishableKey: "pk" } : null,
}));
vi.mock("@/lib/photo-storage", () => ({
  photoStorage: () => storage,
  isLocalDriver: () => false,
  queuePhotoForProcessing: vi.fn(),
  queueDrmForProcessing: queueDrm,
  localStorageDriver: () => null,
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const PHOTO = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const BATCH = "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f70";
const owner = { id: STUDIO, name: "North Peak", slug: "np", region: "ca", role: "owner" };
const staff = { ...owner, role: "staff" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** A stand-in for the Supabase client that answers each table (and rpc) with `rows[name]`. */
function fakeDatabase(rows: Record<string, unknown>) {
  const answer = (name: string) => {
    const chain: object = new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: rows[name] ?? null, error: null })
            : () => chain,
      },
    );
    return chain;
  };
  return { from: answer, rpc: (name: string) => answer(name) };
}

const garbled = (method: string, path = "x") =>
  new Request(`http://localhost/api/v1/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" || method === "DELETE" ? null : "{ not json",
  });

type Route = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const WRITES: [string, () => Promise<Route>, string, string][] = [
  [
    "POST /jobs/:id/upload-batches",
    async () => (await import("./jobs/[id]/upload-batches/route")).POST,
    "POST",
    JOB,
  ],
  [
    "POST /upload-batches/:id/files",
    async () => (await import("./upload-batches/[id]/files/route")).POST,
    "POST",
    BATCH,
  ],
  [
    "POST /upload-batches/:id/part-urls",
    async () => (await import("./upload-batches/[id]/part-urls/route")).POST,
    "POST",
    BATCH,
  ],
  [
    "POST /upload-batches/:id/finish",
    async () => (await import("./upload-batches/[id]/finish/route")).POST,
    "POST",
    BATCH,
  ],
  [
    "GET /photos/:id/upload-parts",
    async () => (await import("./photos/[id]/upload-parts/route")).GET,
    "GET",
    PHOTO,
  ],
  [
    "POST /photos/:id/upload-complete",
    async () => (await import("./photos/[id]/upload-complete/route")).POST,
    "POST",
    PHOTO,
  ],
  [
    "DELETE /photos/:id/upload",
    async () => (await import("./photos/[id]/upload/route")).DELETE,
    "DELETE",
    PHOTO,
  ],
  [
    "POST /photos/:id/retry",
    async () => (await import("./photos/[id]/retry/route")).POST,
    "POST",
    PHOTO,
  ],
  [
    "POST /jobs/:id/photos/bin",
    async () => (await import("./jobs/[id]/photos/bin/route")).POST,
    "POST",
    JOB,
  ],
  [
    "POST /jobs/:id/photos/restore",
    async () => (await import("./jobs/[id]/photos/restore/route")).POST,
    "POST",
    JOB,
  ],
];

beforeEach(() => {
  for (const fn of Object.values(storage)) fn.mockReset();
  storage.presignGet.mockImplementation(async (key: string) => `https://s3.test/${key}?sig`);
});
afterEach(() => {
  afterCallbacks.length = 0;
  scope.mockReset();
  writeRpc.mockReset();
  systemRpc.mockReset();
  queueDrm.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("photo writes check the person, their role and the region before anything else (S4, D113)", () => {
  for (const [name, load, method, id] of WRITES) {
    it(`${name}: signed-out people get not_signed_in, even with a broken body`, async () => {
      scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
      const res = await (await load())(garbled(method), ctx(id));
      expect(res.status).toBe(401);
    });

    it(`${name}: staff get forbidden, even with a broken body (Seenu, answer 6)`, async () => {
      scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: staff, userId: "u" });
      const res = await (await load())(garbled(method), ctx(id));
      expect(res.status).toBe(403);
      expect(writeRpc).not.toHaveBeenCalled();
    });
  }

  for (const [name, load, method, id] of WRITES) {
    it(`${name}: a Canadian studio outside Montréal is refused before the body or storage`, async () => {
      vi.stubEnv("VERCEL_REGION", "iad1");
      vi.spyOn(console, "error").mockImplementation(() => {});
      scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: owner, userId: "u" });
      const res = await (await load())(garbled(method), ctx(id));
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("region_unavailable");
      expect(writeRpc).not.toHaveBeenCalled();
    });

    it(`${name}: a US studio is refused (no US photo storage yet; Seenu, answer 8)`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      scope.mockResolvedValue({
        supabase: fakeDatabase({}),
        studio: { ...owner, region: "us" },
        userId: "u",
      });
      const res = await (await load())(garbled(method), ctx(id));
      expect(res.status).toBe(422);
      expect(writeRpc).not.toHaveBeenCalled();
    });
  }

  it("route files run in Montréal (preferredRegion yul1)", async () => {
    for (const mod of [
      await import("./jobs/[id]/upload-batches/route"),
      await import("./upload-batches/[id]/part-urls/route"),
      await import("./photos/[id]/upload-complete/route"),
      await import("./jobs/[id]/photos/route"),
      await import("./internal/photo-worker/photos/[id]/route"),
      await import("./internal/cron/photos/route"),
    ])
      expect(mod.preferredRegion).toBe("yul1");
  });
});

describe("another studio's batches, photos and previews are not found (leak, D96)", () => {
  // Row-level security hides studio A's rows from studio B: the fake database answers nothing.
  const asStudioB = () =>
    scope.mockResolvedValue({
      supabase: fakeDatabase({}),
      studio: { ...owner, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      userId: "b",
    });
  const json = (method: string, body: unknown) =>
    new Request("http://localhost/api/v1/x", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("a batch: registering files, part URLs and finishing", async () => {
    asStudioB();
    const files = (await import("./upload-batches/[id]/files/route")).POST;
    const parts = (await import("./upload-batches/[id]/part-urls/route")).POST;
    const finish = (await import("./upload-batches/[id]/finish/route")).POST;
    const file = { name: "IMG_0001.JPG", size: 10, sha256: "a".repeat(64) };
    expect((await files(json("POST", { files: [file] }), ctx(BATCH))).status).toBe(404);
    expect(
      (await parts(json("POST", { items: [{ photoId: PHOTO, partNumbers: [1] }] }), ctx(BATCH)))
        .status,
    ).toBe(404);
    expect((await finish(json("POST", {}), ctx(BATCH))).status).toBe(404);
    expect(writeRpc).not.toHaveBeenCalled();
    expect(storage.presignPart).not.toHaveBeenCalled();
  });

  it("a photo: its preview, its upload and a retry", async () => {
    asStudioB();
    const one = (await import("./photos/[id]/route")).GET;
    const uploadParts = (await import("./photos/[id]/upload-parts/route")).GET;
    const complete = (await import("./photos/[id]/upload-complete/route")).POST;
    const retry = (await import("./photos/[id]/retry/route")).POST;
    const cancel = (await import("./photos/[id]/upload/route")).DELETE;
    for (const [route, method] of [
      [one, "GET"],
      [uploadParts, "GET"],
      [complete, "POST"],
      [retry, "POST"],
      [cancel, "DELETE"],
    ] as const)
      expect((await route(new Request("http://localhost/x", { method }), ctx(PHOTO))).status).toBe(
        404,
      );
    expect(storage.presignGet).not.toHaveBeenCalled();
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(writeRpc).not.toHaveBeenCalled();
  });

  it("a job's photos and counts", async () => {
    asStudioB();
    const list = (await import("./jobs/[id]/photos/route")).GET;
    const summary = (await import("./jobs/[id]/photos/summary/route")).GET;
    const bin = (await import("./jobs/[id]/photos/bin/route")).POST;
    expect((await list(new Request("http://localhost/x"), ctx(JOB))).status).toBe(404);
    expect((await summary(new Request("http://localhost/x"), ctx(JOB))).status).toBe(404);
    expect((await bin(json("POST", { photoIds: [PHOTO] }), ctx(JOB))).status).toBe(404);
    expect(writeRpc).not.toHaveBeenCalled();
  });
});

describe("uploading", () => {
  const visiblePhoto = { id: PHOTO, job_id: JOB, status: "uploading" };
  const uploading = (upload_id: string | null, byte_size = PART_BYTES + 5) => [
    { id: PHOTO, studio_id: STUDIO, job_id: JOB, byte_size, upload_id },
  ];
  const key = photoKey({ studioId: STUDIO, jobId: JOB, photoId: PHOTO }, "original");
  const complete = async () =>
    (await import("./photos/[id]/upload-complete/route")).POST(
      new Request("http://localhost/x", { method: "POST" }),
      ctx(PHOTO),
    );

  beforeEach(() => {
    scope.mockResolvedValue({
      supabase: fakeDatabase({ photos: visiblePhoto }),
      studio: owner,
      userId: "u",
    });
  });

  it("completes only when storage has every part at its exact length (never the browser's list)", async () => {
    writeRpc.mockResolvedValue({ data: uploading("up-1"), error: null });
    storage.listParts.mockResolvedValue([{ partNumber: 1, size: PART_BYTES, etag: '"a"' }]);
    const res = await complete();
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "photos.incomplete" });
    expect(storage.complete).not.toHaveBeenCalled();
  });

  it("moves a whole upload on to processing", async () => {
    writeRpc.mockImplementation(async (_r, fn) =>
      fn === "photos_uploading"
        ? { data: uploading("up-1"), error: null }
        : { data: null, error: null },
    );
    const parts = [
      { partNumber: 1, size: PART_BYTES, etag: '"a"' },
      { partNumber: 2, size: 5, etag: '"b"' },
    ];
    storage.listParts.mockResolvedValue(parts);
    storage.head.mockResolvedValue({ size: PART_BYTES + 5 });
    const res = await complete();
    expect(await res.json()).toEqual({ status: "processing" });
    expect(storage.complete).toHaveBeenCalledWith(key, "up-1", parts);
    expect(writeRpc).toHaveBeenLastCalledWith("ca", "mark_photo_uploaded", "u", {
      p_photo_id: PHOTO,
    });
  });

  it("deletes a stored file of the wrong size and fails the photo, so it can be dropped again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    writeRpc.mockImplementation(async (_r, fn) =>
      fn === "photos_uploading"
        ? { data: uploading("up-1", 3), error: null }
        : { data: null, error: null },
    );
    storage.listParts.mockResolvedValue([{ partNumber: 1, size: 3, etag: '"a"' }]);
    storage.head.mockResolvedValue({ size: 4 });
    const res = await complete();
    expect(await res.json()).toEqual({ status: "failed" });
    expect(storage.deleteAllVersions).toHaveBeenCalledWith(key.replace(/original$/, ""));
    expect(writeRpc).toHaveBeenLastCalledWith("ca", "mark_photo_uploaded", "u", {
      p_photo_id: PHOTO,
      p_failure: "incomplete",
    });
  });

  it("starts a storage upload once: a racing request's upload is aborted", async () => {
    scope.mockResolvedValue({
      supabase: fakeDatabase({ upload_batches: { id: BATCH, job_id: JOB, finished_at: null } }),
      studio: owner,
      userId: "u",
    });
    writeRpc.mockImplementation(async (_r, fn) =>
      fn === "photos_uploading"
        ? { data: uploading(null), error: null }
        : { data: "up-first", error: null },
    );
    storage.createMultipart.mockResolvedValue("up-mine");
    storage.presignPart.mockImplementation(
      async (_k, id, n, len) => `https://s3.test/${id}/${n}/${len}`,
    );
    const res = await (await import("./upload-batches/[id]/part-urls/route")).POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ photoId: PHOTO, partNumbers: [2, 1] }] }),
      }),
      ctx(BATCH),
    );
    const body = await res.json();
    expect(storage.abort).toHaveBeenCalledWith(key, "up-mine");
    // Each URL carries its part's exact length.
    expect(body.urls.map((u: { url: string }) => u.url)).toEqual([
      `https://s3.test/up-first/2/5`,
      `https://s3.test/up-first/1/${PART_BYTES}`,
    ]);
    expect(body.expiresIn).toBe(900);
  });

  it("names a refusal so the screen can say why (closed job, 50,000 photos)", async () => {
    scope.mockResolvedValue({
      supabase: fakeDatabase({ jobs: { id: JOB, status: "closed" } }),
      studio: owner,
      userId: "u",
    });
    writeRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "job_closed" } });
    const res = await (await import("./jobs/[id]/upload-batches/route")).POST(
      new Request("http://localhost/x", { method: "POST" }),
      ctx(JOB),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "photos.jobClosed" });
  });

  it("sends filenames in the body only, without folders, to the database", async () => {
    scope.mockResolvedValue({
      supabase: fakeDatabase({ upload_batches: { id: BATCH, job_id: JOB, finished_at: null } }),
      studio: owner,
      userId: "u",
    });
    writeRpc.mockResolvedValue({
      data: [{ index: 0, outcome: "new", photo_id: PHOTO }],
      error: null,
    });
    const files = (await import("./upload-batches/[id]/files/route")).POST;
    const ok = await files(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [{ name: "IMG_0001.JPG", size: PART_BYTES * 2, sha256: "a".repeat(64) }],
        }),
      }),
      ctx(BATCH),
    );
    expect(await ok.json()).toEqual({
      results: [{ index: 0, outcome: "new", photoId: PHOTO, partSize: PART_BYTES, partCount: 2 }],
    });
    const bad = await files(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [{ name: "Day 1/IMG.JPG", size: 1, sha256: "a".repeat(64) }],
        }),
      }),
      ctx(BATCH),
    );
    expect(bad.status).toBe(400);
  });
});

describe("recovering and cleaning up (review CR2, CR3, S11)", () => {
  const key = photoKey({ studioId: STUDIO, jobId: JOB, photoId: PHOTO }, "original");
  const uploading = [
    { id: PHOTO, studio_id: STUDIO, job_id: JOB, byte_size: 10, upload_id: "up-1" },
  ];
  const complete = async () =>
    (await import("./photos/[id]/upload-complete/route")).POST(
      new Request("http://localhost/x", { method: "POST" }),
      ctx(PHOTO),
    );

  it("marks a photo uploaded when an earlier request already completed its upload", async () => {
    scope.mockResolvedValue({
      supabase: fakeDatabase({ photos: { id: PHOTO, job_id: JOB } }),
      studio: owner,
      userId: "u",
    });
    writeRpc.mockImplementation(async (_r, fn) =>
      fn === "photos_uploading" ? { data: uploading, error: null } : { data: null, error: null },
    );
    storage.listParts.mockRejectedValue(new StorageError("not_found"));
    storage.head.mockResolvedValue({ size: 10 });
    expect(await (await complete()).json()).toEqual({ status: "processing" });
    expect(writeRpc).toHaveBeenLastCalledWith("ca", "mark_photo_uploaded", "u", {
      p_photo_id: PHOTO,
    });
    expect(storage.deleteAllVersions).not.toHaveBeenCalled();
  });

  it("cancels a photo whose upload was aborted with nothing whole stored", async () => {
    scope.mockResolvedValue({
      supabase: fakeDatabase({ photos: { id: PHOTO, job_id: JOB } }),
      studio: owner,
      userId: "u",
    });
    writeRpc.mockImplementation(async (_r, fn) =>
      fn === "photos_uploading" ? { data: uploading, error: null } : { data: null, error: null },
    );
    storage.listParts.mockRejectedValue(new StorageError("not_found"));
    storage.head.mockResolvedValue(null);
    const res = await complete();
    expect(res.status).toBe(409);
    expect(writeRpc).toHaveBeenLastCalledWith("ca", "cancel_photo_upload", "u", {
      p_photo_id: PHOTO,
    });
  });

  it("deletes the stored object when the photo was cancelled while completing", async () => {
    let visible: unknown = { id: PHOTO, job_id: JOB };
    const supabase = {
      ...fakeDatabase({}),
      from: () => {
        const chain: object = new Proxy(
          {},
          {
            get: (_t, prop: string) =>
              prop === "then"
                ? (resolve: (v: unknown) => void) => resolve({ data: visible, error: null })
                : () => chain,
          },
        );
        return chain;
      },
    };
    scope.mockResolvedValue({ supabase, studio: owner, userId: "u" });
    writeRpc.mockImplementation(async (_r, fn) => {
      if (fn === "photos_uploading") return { data: uploading, error: null };
      visible = null;
      return { data: null, error: { code: "P0002", message: "Photo not found" } };
    });
    storage.listParts.mockResolvedValue([{ partNumber: 1, size: 10, etag: '"a"' }]);
    storage.head.mockResolvedValue({ size: 10 });
    expect((await complete()).status).toBe(404);
    expect(storage.deleteAllVersions).toHaveBeenCalledWith(key.replace(/original$/, ""));
  });

  it("reads a worker's body only up to 4 KB, whatever its headers claim", async () => {
    vi.stubEnv("PHOTO_WORKER_SECRETS", "s".repeat(32));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const big = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x".repeat(5000)));
        c.close();
      },
    });
    const req = new Request(`https://x/api/v1/internal/photo-worker/photos/${PHOTO}/result`, {
      method: "POST",
      headers: { "Daybell-Region": "ca", "content-type": "application/json" },
      body: big,
      duplex: "half",
    } as RequestInit);
    const res = await (await import("./internal/photo-worker/photos/[id]/result/route")).POST(
      req,
      ctx(PHOTO),
    );
    expect(res.status).toBe(401);
    expect(systemRpc).not.toHaveBeenCalled();
  });
});

describe("the image worker's routes accept signed requests only", () => {
  const SECRET = "s".repeat(32);
  const path = `/api/v1/internal/photo-worker/photos/${PHOTO}`;
  const signed = async (
    method: "GET" | "POST",
    p: string,
    body = "",
    region = "ca",
    secret = SECRET,
  ) =>
    new Request(`https://staging.example${p}`, {
      method,
      headers: {
        "Daybell-Signature": await signWorkerRequest(secret, { method, path: p, region, body }),
        "Daybell-Region": region,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });
  const read = async (req: Request) =>
    (await import("./internal/photo-worker/photos/[id]/route")).GET(req, ctx(PHOTO));
  const result = async (req: Request) =>
    (await import("./internal/photo-worker/photos/[id]/result/route")).POST(req, ctx(PHOTO));

  beforeEach(() => {
    vi.stubEnv("PHOTO_WORKER_SECRETS", `${"o".repeat(32)},${SECRET}`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    systemRpc.mockResolvedValue({
      data: {
        id: PHOTO,
        studio_id: STUDIO,
        job_id: JOB,
        status: "processing",
        sha256: "a".repeat(64),
        byte_size: 10,
        attempt: 2,
        studio_name: "North Peak",
      },
      error: null,
    });
  });

  it("answers a genuine read with ids, hash, size and the studio's name, never a filename", async () => {
    const res = await read(await signed("GET", path));
    expect(res.status).toBe(200);
    expect((await res.json()).photo).toEqual({
      id: PHOTO,
      studioId: STUDIO,
      jobId: JOB,
      status: "processing",
      sha256: "a".repeat(64),
      byteSize: 10,
      attempt: 2,
      studioName: "North Peak",
      drmStatus: null,
      drmAttempt: 0,
    });
    expect(systemRpc).toHaveBeenCalledWith("ca", "photo_for_worker", { p_photo_id: PHOTO });
  });

  it("refuses unsigned, wrongly signed, replayed-elsewhere and other-region requests", async () => {
    expect((await read(new Request(`https://x${path}`))).status).toBe(401);
    expect((await read(await signed("GET", path, "", "ca", "x".repeat(32)))).status).toBe(401);
    // Signed for another photo's path.
    const other = await signed("GET", path.replace(PHOTO, JOB));
    expect((await read(new Request(`https://x${path}`, { headers: other.headers }))).status).toBe(
      401,
    );
    // Region swapped after signing.
    const req = await signed("GET", path);
    const headers = new Headers(req.headers);
    headers.set("Daybell-Region", "us");
    expect((await read(new Request(req.url, { headers }))).status).toBe(401);
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("records a signed result, and refuses a changed one", async () => {
    systemRpc.mockResolvedValue({ data: true, error: null });
    const body = JSON.stringify({
      status: "ready",
      attempt: 2,
      width: 10,
      height: 8,
      capturedAt: "2026-10-01T09:30:05.47",
      qr: { kind: "none" },
    });
    const res = await result(await signed("POST", `${path}/result`, body));
    expect(await res.json()).toEqual({ recorded: true });
    expect(systemRpc).toHaveBeenCalledWith("ca", "record_photo_result", {
      p_photo_id: PHOTO,
      p_attempt: 2,
      p_result: {
        status: "ready",
        width: 10,
        height: 8,
        captured_at: "2026-10-01T09:30:05.47",
        qr: { kind: "none" },
      },
    });
    // After the response, the photo's batch is tagged (ADR 0018).
    expect(afterCallbacks).toHaveLength(1);
    afterCallbacks.length = 0;
    systemRpc.mockClear();
    const genuine = await signed("POST", `${path}/result`, body);
    const forged = new Request(genuine.url, {
      method: "POST",
      headers: genuine.headers,
      body: body.replace("ready", "failed"),
    });
    expect((await result(forged)).status).toBe(401);
    expect(systemRpc).not.toHaveBeenCalled();
    // A ready result from a worker that doesn't read cards is refused (its message is tried again; security review 2).
    const old = JSON.stringify({
      status: "ready",
      attempt: 2,
      width: 10,
      height: 8,
      capturedAt: null,
    });
    expect((await result(await signed("POST", `${path}/result`, old))).status).toBe(400);
    expect(systemRpc).not.toHaveBeenCalled();
  });

  describe("DRM packaging (ADR 0034)", () => {
    const ARN = "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
    const KEY_ID = "2b0e6a4c-9f6e-4f0a-8d2b-3c4d5e6f7a8b";
    const wrapped = Buffer.from("k".repeat(184)).toString("base64");
    const drm = async (req: Request) =>
      (await import("./internal/photo-worker/photos/[id]/drm/route")).POST(req, ctx(PHOTO));
    const ready = {
      status: "ready",
      attempt: 3,
      keyId: KEY_ID,
      wrappedKey: wrapped,
      kmsKeyArn: ARN,
      width: 1600,
      height: 1066,
      bytes: 61234,
    };
    const S3_ENV = {
      STORAGE_DRIVER: "s3",
      AWS_REGION: "ca-central-1",
      PHOTO_BUCKET_CA: "daybell-staging-ca-photos",
      PHOTO_QUEUE_URL_CA: "https://sqs.ca-central-1.amazonaws.com/123456789012/q",
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/web",
    };

    it("reads the photo's DRM request with it", async () => {
      systemRpc.mockResolvedValueOnce({
        data: {
          id: PHOTO,
          studio_id: STUDIO,
          job_id: JOB,
          status: "ready",
          sha256: "a".repeat(64),
          byte_size: 10,
          attempt: 1,
          studio_name: "North Peak",
          drm_status: "requested",
          drm_attempt: 3,
        },
        error: null,
      });
      const res = await read(await signed("GET", path));
      expect((await res.json()).photo).toMatchObject({ drmStatus: "requested", drmAttempt: 3 });
    });

    it("records a signed clip with the wrapped key as bytea, logging nothing about it", async () => {
      const logs = (["log", "info", "warn", "error"] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {}),
      );
      systemRpc.mockResolvedValue({ data: true, error: null });
      const res = await drm(await signed("POST", `${path}/drm`, JSON.stringify(ready)));
      expect(await res.json()).toEqual({ recorded: true });
      expect(systemRpc).toHaveBeenCalledWith("ca", "record_photo_drm_result", {
        p_photo_id: PHOTO,
        p_attempt: 3,
        p_key_id: KEY_ID,
        p_wrapped_key: `\\x${Buffer.from(wrapped, "base64").toString("hex")}`,
        p_kms_key_arn: ARN,
        p_width: 1600,
        p_height: 1066,
        p_bytes: 61234,
      });
      for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(wrapped);
      for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    });

    it("records a permanent failure for its attempt, logging the id and reason only", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      systemRpc.mockResolvedValue({ data: false, error: null });
      const body = JSON.stringify({ status: "failed", attempt: 3, reason: "unreadable" });
      expect(await (await drm(await signed("POST", `${path}/drm`, body))).json()).toEqual({
        recorded: false,
      });
      expect(systemRpc).toHaveBeenCalledWith("ca", "record_photo_drm_failed", {
        p_photo_id: PHOTO,
        p_attempt: 3,
      });
      expect(warn.mock.calls).toEqual([["drm_failed", PHOTO, "unreadable"]]);
    });

    it("refuses an unsigned or changed result, a key outside ca-central-1 and a malformed key", async () => {
      expect(
        (await drm(new Request(`https://x${path}/drm`, { method: "POST", body: "{}" }))).status,
      ).toBe(401);
      const genuine = await signed("POST", `${path}/drm`, JSON.stringify(ready));
      const forged = new Request(genuine.url, {
        method: "POST",
        headers: genuine.headers,
        body: JSON.stringify({ ...ready, attempt: 4 }),
      });
      expect((await drm(forged)).status).toBe(401);
      for (const bad of [
        { ...ready, kmsKeyArn: ARN.replace("ca-central-1", "us-east-1") },
        { ...ready, wrappedKey: "not base64!" },
        { ...ready, keyId: "2b0e6a4c-9f6e-1f0a-8d2b-3c4d5e6f7a8b" },
        { ...ready, width: 1601 },
      ])
        expect((await drm(await signed("POST", `${path}/drm`, JSON.stringify(bad)))).status).toBe(
          400,
        );
      expect(systemRpc).not.toHaveBeenCalled();
    });

    it("requests a ready photo's clip after its result, only where packaging is on", async () => {
      const body = JSON.stringify({
        status: "ready",
        attempt: 2,
        width: 10,
        height: 8,
        capturedAt: null,
        qr: { kind: "none" },
      });
      // Off: no KMS key here.
      for (const [name, value] of Object.entries(S3_ENV)) vi.stubEnv(name, value);
      systemRpc.mockResolvedValue({ data: true, error: null });
      await result(await signed("POST", `${path}/result`, body));
      expect(afterCallbacks).toHaveLength(1);
      expect(systemRpc).not.toHaveBeenCalledWith("ca", "photo_drm_requested", expect.anything());
      expect(queueDrm).not.toHaveBeenCalled();
      // On: DRM_KMS_KEY_ARN_CA set.
      afterCallbacks.length = 0;
      vi.stubEnv("DRM_KMS_KEY_ARN_CA", ARN);
      systemRpc.mockImplementation(async (_r, fn) =>
        fn === "photo_drm_requested" ? { data: 5, error: null } : { data: true, error: null },
      );
      await result(await signed("POST", `${path}/result`, body));
      expect(afterCallbacks).toHaveLength(2);
      await afterCallbacks[1]?.();
      expect(systemRpc).toHaveBeenCalledWith("ca", "photo_drm_requested", { p_photo_id: PHOTO });
      expect(queueDrm).toHaveBeenCalledWith("ca", PHOTO);
      // A photo that can't be shown (null) isn't queued.
      afterCallbacks.length = 0;
      queueDrm.mockClear();
      systemRpc.mockImplementation(async (_r, fn) =>
        fn === "photo_drm_requested" ? { data: null, error: null } : { data: true, error: null },
      );
      await result(await signed("POST", `${path}/result`, body));
      await afterCallbacks[1]?.();
      expect(queueDrm).not.toHaveBeenCalled();
    });
  });

  it("fails closed without secrets, naming the variable only", async () => {
    vi.stubEnv("PHOTO_WORKER_SECRETS", "");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await read(await signed("GET", path))).status).toBe(500);
    expect(errors).toHaveBeenCalledWith(
      "photo_worker_misconfigured",
      "PHOTO_WORKER_SECRETS is not set",
    );
  });
});

describe("the daily clean-up", () => {
  const cron = async (auth?: string) =>
    (await import("./internal/cron/photos/route")).GET(
      new Request(
        "https://x/api/v1/internal/cron/photos",
        auth ? { headers: { authorization: auth } } : {},
      ),
    );
  const SECRET = "c".repeat(40);

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("refuses anyone without the cron secret", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron(`Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("deletes stored versions first, then only the rows whose objects are gone", async () => {
    const due = [
      { id: PHOTO, studio_id: STUDIO, job_id: JOB },
      { id: JOB, studio_id: STUDIO, job_id: JOB },
    ];
    systemRpc.mockImplementation(async (_r, fn, args) => {
      if (fn === "finish_idle_batches") return { data: 1, error: null };
      if (fn === "abandoned_uploads") return { data: [], error: null };
      if (fn === "begin_photo_purge") return { data: due, error: null };
      if (fn === "delete_purged_photos") return { data: args.p_photo_ids.length, error: null };
      return { data: null, error: null };
    });
    storage.deleteAllVersions.mockResolvedValueOnce(3).mockRejectedValueOnce(new Error("S3 down"));
    const res = await cron(`Bearer ${SECRET}`);
    expect(await res.json()).toEqual({
      finishedBatches: 1,
      droppedUploads: 0,
      purgedPhotos: 1,
      taggedBatches: 0,
      drmQueued: 0,
      drmGivenUp: 0,
    });
    expect(systemRpc).toHaveBeenCalledWith("ca", "delete_purged_photos", { p_photo_ids: [PHOTO] });
    // DRM packaging isn't set up here: nothing asked.
    expect(systemRpc).not.toHaveBeenCalledWith("ca", "photos_drm_due", expect.anything());
  });

  it("queues DRM retries and the backfill, 2,000 at most, and logs give-ups by id only (ADR 0034, C8)", async () => {
    for (const [name, value] of Object.entries({
      STORAGE_DRIVER: "s3",
      AWS_REGION: "ca-central-1",
      PHOTO_BUCKET_CA: "daybell-staging-ca-photos",
      PHOTO_QUEUE_URL_CA: "https://sqs.ca-central-1.amazonaws.com/123456789012/q",
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/web",
      DRM_KMS_KEY_ARN_CA: "arn:aws:kms:ca-central-1:123456789012:alias/daybell-staging-ca-drm",
    }))
      vi.stubEnv(name, value);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    systemRpc.mockImplementation(async (_r, fn) => {
      if (fn === "finish_idle_batches") return { data: 0, error: null };
      if (fn === "photos_drm_due")
        return {
          data: [
            { id: JOB, studio_id: STUDIO, job_id: JOB, outcome: "failed" },
            { id: PHOTO, studio_id: STUDIO, job_id: JOB, outcome: "retry" },
            { id: BATCH, studio_id: STUDIO, job_id: JOB, outcome: "backfill" },
          ],
          error: null,
        };
      return { data: [], error: null };
    });
    queueDrm.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SQS down"));
    const res = await cron(`Bearer ${SECRET}`);
    expect(await res.json()).toMatchObject({ drmQueued: 1, drmGivenUp: 1 });
    expect(systemRpc).toHaveBeenCalledWith("ca", "photos_drm_due", { p_limit: 2000 });
    expect(queueDrm.mock.calls).toEqual([
      ["ca", PHOTO],
      ["ca", BATCH],
    ]);
    expect(warn.mock.calls).toEqual([["drm_unavailable", JOB]]);
  });
});
