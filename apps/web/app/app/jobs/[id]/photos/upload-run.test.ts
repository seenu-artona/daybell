import { createHash } from "node:crypto";
import { PART_BYTES } from "@daybell/core";
import { describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/client-api";
import {
  type DropFile,
  retryDelay,
  type UploadDeps,
  type UploadProgress,
  UploadRun,
} from "./upload-run";

// The browser's upload engine (ADR 0016) against a fake API and storage: what is registered, which parts are sent,
// how a dropped connection and a resume behave. No network.

const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const file = (name: string, bytes: number | string): DropFile => {
  const body = typeof bytes === "string" ? bytes : "x".repeat(bytes);
  return {
    file: new File([body], name.split("/").at(-1) ?? name, { type: "image/jpeg" }),
    path: name,
  };
};
const sha = async (f: File) =>
  createHash("sha256")
    .update(Buffer.from(await f.arrayBuffer()))
    .digest("hex");
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (status: number, code: string, form?: string): ApiResult<never> => ({
  ok: false,
  status,
  code,
  message: "",
  fields: form ? { form } : {},
});

/** A fake API that keeps photos like the server: duplicates by hash, parts stored per photo. */
function fakeServer(
  options: { existing?: Map<string, { id: string; parts: number[] }>; dupes?: Set<string> } = {},
) {
  const photos = new Map<
    string,
    { id: string; size: number; parts: Set<number>; partCount: number }
  >();
  for (const [hash, p] of options.existing ?? [])
    photos.set(hash, { id: p.id, size: 0, parts: new Set(p.parts), partCount: 0 });
  const byId = () => new Map([...photos.values()].map((p) => [p.id, p]));
  const calls: string[] = [];
  const registered: unknown[] = [];
  let n = 0;
  const api = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push(`${init?.method ?? "GET"} ${path.replace(/[0-9a-f-]{36}|p\d+/g, ":id")}`);
    if (path.endsWith("/upload-batches")) return ok({ batchId: "batch-1" });
    if (path.endsWith("/files")) {
      const { files } = (
        init as { body: { files: { name: string; size: number; sha256: string }[] } }
      ).body;
      registered.push(...files);
      return ok({
        results: files.map((f, index) => {
          const partCount = Math.ceil(f.size / PART_BYTES);
          if (options.dupes?.has(f.sha256))
            return { index, outcome: "duplicate", photoId: null, partSize: PART_BYTES, partCount };
          const existing = photos.get(f.sha256);
          if (existing) {
            existing.size = f.size;
            existing.partCount = partCount;
            return {
              index,
              outcome: "resume",
              photoId: existing.id,
              partSize: PART_BYTES,
              partCount,
            };
          }
          const id = `p${++n}`;
          photos.set(f.sha256, { id, size: f.size, parts: new Set(), partCount });
          return { index, outcome: "new", photoId: id, partSize: PART_BYTES, partCount };
        }),
      });
    }
    if (path.endsWith("/part-urls")) {
      const { items } = (init as { body: { items: { photoId: string; partNumbers: number[] }[] } })
        .body;
      return ok({
        urls: items.flatMap((i) =>
          i.partNumbers.map((p) => ({
            photoId: i.photoId,
            partNumber: p,
            url: `put:${i.photoId}:${p}`,
          })),
        ),
        expiresIn: 900,
      });
    }
    const id = path.split("/")[2] as string;
    const photo = byId().get(id);
    if (path.endsWith("/upload-parts"))
      return ok({
        parts: [...(photo?.parts ?? [])],
        partSize: PART_BYTES,
        partCount: photo?.partCount ?? 1,
      });
    if (path.endsWith("/upload-complete")) {
      if (!photo || photo.parts.size !== photo.partCount)
        return fail(409, "conflict", "photos.incomplete");
      return ok({ status: "processing" });
    }
    if (path.endsWith("/finish")) return ok(undefined);
    return fail(404, "not_found");
  });
  const put = vi.fn(async (url: string) => {
    const [, id, part] = url.split(":");
    byId()
      .get(id as string)
      ?.parts.add(Number(part));
    return 200;
  });
  return { api, put, calls, registered, photos };
}

const deps = (
  server: ReturnType<typeof fakeServer>,
  extra: Partial<UploadDeps> = {},
): UploadDeps => ({
  api: server.api as unknown as UploadDeps["api"],
  put: server.put,
  hash: sha,
  online: async () => {},
  sleep: async () => {},
  ...extra,
});

async function run(files: DropFile[], d: UploadDeps): Promise<UploadProgress> {
  let last: UploadProgress | null = null;
  const upload = new UploadRun(JOB, files, d, (p) => {
    last = p;
  });
  await upload.start();
  return last ?? upload.progress;
}

describe("UploadRun", () => {
  it("skips hidden and non-JPEG files, uploads the same file once, and finishes the batch with the skipped count", async () => {
    const server = fakeServer();
    const progress = await run(
      [
        file("Day 1/IMG_0001.JPG", "one"),
        file("Day 1/copy.jpg", "one"),
        file("Day 1/IMG_0002.jpg", "two"),
        file("Day 1/notes.png", "png"),
        file("Day 1/.DS_Store", "ds"),
        file("Day 1/._IMG_0001.JPG", "mac"),
      ],
      deps(server),
    );
    expect(progress).toMatchObject({
      phase: "done",
      total: 3,
      uploaded: 2,
      duplicates: 1,
      skipped: 1,
      failed: 0,
    });
    // Only the file's own name is sent, never its folder.
    expect(server.registered).toEqual([
      expect.objectContaining({ name: "IMG_0001.JPG" }),
      expect.objectContaining({ name: "IMG_0002.jpg" }),
    ]);
    // The browser's own duplicate (the same file twice in the drop) is counted on the batch too (review CR10).
    expect(server.api).toHaveBeenLastCalledWith("/upload-batches/batch-1/finish", {
      method: "POST",
      body: { skipped: 1, duplicates: 1 },
    });
  });

  it("counts files the job already has as duplicates and sends none of their bytes", async () => {
    const one = file("a.jpg", "one");
    const server = fakeServer({ dupes: new Set([await sha(one.file)]) });
    const progress = await run([one], deps(server));
    expect(progress).toMatchObject({ uploaded: 0, duplicates: 1 });
    expect(server.put).not.toHaveBeenCalled();
  });

  it("resumes a file still uploading by sending only the parts storage doesn't have", async () => {
    const big = file("big.jpg", PART_BYTES * 2 + 10);
    const hash = await sha(big.file);
    const server = fakeServer({ existing: new Map([[hash, { id: "p-old", parts: [1, 3] }]]) });
    const progress = await run([big], deps(server));
    expect(server.put.mock.calls.map(([url]) => url)).toEqual(["put:p-old:2"]);
    expect(progress).toMatchObject({ uploaded: 1, failed: 0 });
  });

  it("only completes a resumed file whose parts storage already has, sending no bytes", async () => {
    const big = file("big.jpg", PART_BYTES * 2 + 10);
    const hash = await sha(big.file);
    const server = fakeServer({ existing: new Map([[hash, { id: "p-old", parts: [1, 2, 3] }]]) });
    const progress = await run([big], deps(server));
    expect(server.put).not.toHaveBeenCalled();
    expect(server.calls).toContain("POST /photos/p-old/upload-complete");
    expect(progress).toMatchObject({ uploaded: 1, failed: 0 });
  });

  it("tries a part again after a dropped connection, with growing pauses", async () => {
    const server = fakeServer();
    const real = server.put.getMockImplementation() as (url: string) => Promise<number>;
    server.put.mockImplementationOnce(async () => 0).mockImplementationOnce(async () => 503);
    server.put.mockImplementation(real);
    const sleep = vi.fn(async (_ms: number) => {});
    const progress = await run([file("a.jpg", "one")], deps(server, { sleep }));
    expect(progress).toMatchObject({ uploaded: 1, failed: 0 });
    expect(sleep.mock.calls.map(([ms]) => ms).filter((ms) => ms > 0)).toEqual([1000, 2000]);
    expect([1, 2, 3, 6, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 30_000, 30_000]);
  });

  it("waits while the browser is offline and says so", async () => {
    const server = fakeServer();
    let online!: () => void;
    let offline = true;
    const phases: string[] = [];
    const upload = new UploadRun(
      JOB,
      [file("a.jpg", "one")],
      deps(server, {
        online: () => (offline ? new Promise<void>((ok) => (online = ok)) : Promise.resolve()),
        sleep: () => new Promise((ok) => setTimeout(ok, 0)),
      }),
      (p) => phases.push(p.phase),
    );
    const done = upload.start();
    await new Promise((ok) => setTimeout(ok, 10));
    expect(phases.at(-1)).toBe("offline");
    expect(server.api).not.toHaveBeenCalled();
    offline = false;
    online();
    await done;
    expect(phases.at(-1)).toBe("done");
  });

  it("stops and says why when the job refuses uploads", async () => {
    const server = fakeServer();
    server.api.mockResolvedValueOnce(fail(409, "conflict", "photos.jobClosed"));
    const progress = await run([file("a.jpg", "one")], deps(server));
    expect(progress).toMatchObject({ phase: "stopped", problem: "photos.jobClosed" });
    expect(server.put).not.toHaveBeenCalled();
  });

  it("remembers the files that failed, so Retry sends only those", async () => {
    const server = fakeServer();
    server.put.mockImplementation(async (url: string) => (url.includes("p1") ? 400 : 200));
    const files = [file("a.jpg", "one"), file("b.jpg", "two")];
    const upload = new UploadRun(JOB, files, deps(server), () => {});
    await upload.start();
    expect(upload.progress).toMatchObject({ uploaded: 0, failed: 2 });
    expect(
      upload
        .failed()
        .map((f) => f.path)
        .sort(),
    ).toEqual(["a.jpg", "b.jpg"]);
  });

  it("uploads what was registered before a later chunk was refused, then stops and says why (review CR9)", async () => {
    const server = fakeServer();
    const real = server.api.getMockImplementation() as NonNullable<
      ReturnType<typeof server.api.getMockImplementation>
    >;
    let chunks = 0;
    server.api.mockImplementation(async (path, init) => {
      if (path.endsWith("/files") && ++chunks === 2)
        return fail(409, "conflict", "photos.photoLimit");
      return real(path, init);
    });
    const files = Array.from({ length: 501 }, (_, i) => file(`IMG_${i}.jpg`, `photo ${i}`));
    const progress = await run(files, deps(server));
    expect(progress).toMatchObject({
      phase: "stopped",
      problem: "photos.photoLimit",
      uploaded: 500,
    });
    expect(server.calls).toContain("POST /upload-batches/batch-1/finish");
  });

  it("counts a photo another request already finished as uploaded", async () => {
    const server = fakeServer();
    const real = server.api.getMockImplementation() as NonNullable<
      ReturnType<typeof server.api.getMockImplementation>
    >;
    server.api.mockImplementation(async (path, init) =>
      path.endsWith("/upload-complete")
        ? fail(409, "conflict", "photos.notUploading")
        : real(path, init),
    );
    expect(await run([file("a.jpg", "one")], deps(server))).toMatchObject({
      uploaded: 1,
      failed: 0,
    });
  });

  it("Stop cancels the photos that hadn't finished uploading (review CR14)", async () => {
    const server = fakeServer();
    let release!: () => void;
    const held = new Promise<number>((ok) => {
      release = () => ok(200);
    });
    server.put.mockImplementation(() => held);
    const upload = new UploadRun(
      JOB,
      [file("a.jpg", "one"), file("b.jpg", "two")],
      deps(server),
      () => {},
    );
    const started = upload.start();
    await new Promise((ok) => setTimeout(ok, 20));
    const cancelled = upload.cancel();
    release();
    await started;
    await cancelled;
    expect(upload.progress.phase).toBe("stopped");
    expect(server.calls.filter((c) => c.startsWith("DELETE"))).toHaveLength(2);
  });

  it("sends a part again when storage says it is missing at completion", async () => {
    const server = fakeServer();
    const real = server.put.getMockImplementation() as (url: string) => Promise<number>;
    // The first PUT "succeeds" but never arrives.
    server.put.mockImplementationOnce(async () => 200);
    server.put.mockImplementation(real);
    const progress = await run([file("a.jpg", "one")], deps(server));
    expect(progress).toMatchObject({ uploaded: 1, failed: 0 });
    expect(server.put).toHaveBeenCalledTimes(2);
  });
});
