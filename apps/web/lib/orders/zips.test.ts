import { Readable } from "node:stream";
import { SHOP_CONFLICTS } from "@daybell/api";
import { DOWNLOAD_VARIANT, photoKey } from "@daybell/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Zips (ADR 0024): streamed one file at a time, in store mode, named by the order's reference, never a child; every
// file must exist first (a missing one is asked for and the request answered 409 with Retry-After, never a partial
// zip; one that can't be made is a 409 for good); at most 500 files; storage is asserted to the studio's region; the
// print files carry a manifest.csv with no names.
vi.mock("server-only", () => ({}));
const { shopFn, writeRpc, heads, streams, queueDownloads, storageGuard } = vi.hoisted(() => ({
  shopFn: vi.fn(),
  writeRpc: vi.fn(),
  heads: new Set<string>(),
  streams: vi.fn(),
  queueDownloads: vi.fn(),
  storageGuard: vi.fn(),
}));
vi.mock("../shop/http", async (original) => ({
  ...(await original<typeof import("../shop/http")>()),
  callShopFunction: shopFn,
}));
vi.mock("../supabase/service", () => ({ orderWriteRpc: writeRpc }));
vi.mock("../photo-storage", () => ({
  photoStorage: () => ({ head: async (key: string) => (heads.has(key) ? { size: 1 } : null) }),
  photoDownloadStorage: () => ({ getStream: streams }),
}));
vi.mock("../checkout/downloads", () => ({ DOWNLOAD_PREPARING_SECONDS: 20, queueDownloads }));
vi.mock("../region-guard", () => ({
  assertFunctionRegion: vi.fn(),
  assertStorageRegion: storageGuard,
}));

const { zipResponse, downloadAll, printFiles } = await import("./zips");
const { ConflictLater } = await import("../shop/http");

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const session = { region: "ca", hash: "h" } as never;
const key = (photo: string) =>
  photoKey({ studioId: STUDIO, jobId: JOB, photoId: photo }, DOWNLOAD_VARIANT);

/** The names of a zip's entries, read from its local file headers (store mode, so contents are plain). */
function entryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let at = zip.indexOf("PK\x03\x04");
  while (at >= 0 && at < zip.length) {
    const length = zip.readUInt16LE(at + 26);
    const extra = zip.readUInt16LE(at + 28);
    names.push(zip.subarray(at + 30, at + 30 + length).toString());
    at = zip.indexOf("PK\x03\x04", at + 30 + length + extra);
  }
  return names;
}
const body = async (res: Response) => Buffer.from(await res.arrayBuffer());

let logs: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logs = vi.spyOn(console, "error").mockImplementation(() => {});
  streams.mockImplementation(async (k: string) =>
    Readable.from([Buffer.from(`jpeg:${k.slice(-4)}`)]),
  );
});
afterEach(() => {
  logs.mockRestore();
  heads.clear();
  vi.clearAllMocks();
});

describe("zipResponse", () => {
  it("streams each file in order, stored as is, as an attachment never cached", async () => {
    const res = zipResponse("DB-ABC.zip", [
      { name: "a.jpg", open: async () => Readable.from([Buffer.from("first")]) },
      { name: "b.jpg", open: async () => "second" },
    ]);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="DB-ABC.zip"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const zip = await body(res);
    expect(entryNames(zip)).toEqual(["a.jpg", "b.jpg"]);
    expect(zip.indexOf("first")).toBeGreaterThan(0);
    expect(zip.indexOf("second")).toBeGreaterThan(zip.indexOf("first"));
    expect(zip.indexOf("PK\x05\x06")).toBeGreaterThan(0);
  });

  it("cuts the stream when a file fails part way, and logs a fixed name", async () => {
    const res = zipResponse("x.zip", [
      { name: "a.jpg", open: async () => "first" },
      {
        name: "b.jpg",
        open: async () => {
          throw new Error("storage down for Priya");
        },
      },
    ]);
    await expect(body(res)).rejects.toThrow();
    expect(logs.mock.calls).toEqual([["zip_failed"]]);
  });
});

describe("downloadAll (a parent's Download all)", () => {
  const found = (n: number) => ({
    studio_id: STUDIO,
    reference: "7KQ2M9XA",
    files: Array.from({ length: n }, (_, i) => ({
      job_id: JOB,
      photo_id: i % 2 ? P2 : P1,
      n: i + 1,
    })),
  });

  it("zips every paid download, named by the reference, after asserting the storage region", async () => {
    shopFn.mockResolvedValue(found(2));
    heads.add(key(P1)).add(key(P2));
    const res = await downloadAll(session, ORDER);
    expect(storageGuard).toHaveBeenCalledWith("ca");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("7KQ2M9XA");
    const names = entryNames(await body(res));
    expect(names).toHaveLength(2);
    for (const name of names) expect(name).toContain("7KQ2M9XA");
  });

  it("asks for missing files and answers 409 with Retry-After, never a partial zip", async () => {
    shopFn.mockResolvedValueOnce(found(2)).mockResolvedValueOnce({ queued: [P2], unavailable: 0 });
    heads.add(key(P1));
    const err = await downloadAll(session, ORDER).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictLater);
    expect(err.seconds).toBe(20);
    expect(shopFn.mock.calls[1]?.[2]).toEqual({
      p_session_hash: "h",
      p_order_id: ORDER,
      p_photo_ids: [P2],
    });
    expect(queueDownloads).toHaveBeenCalledWith("ca", [P2]);
    expect(streams).not.toHaveBeenCalled();
  });

  it("says a file that can't be made is unavailable, and refuses too many files or none", async () => {
    shopFn.mockResolvedValueOnce(found(1)).mockResolvedValueOnce({ queued: [], unavailable: 1 });
    expect((await downloadAll(session, ORDER).catch((e) => e)).fields).toEqual({
      form: SHOP_CONFLICTS.downloadUnavailable,
    });
    storageGuard.mockClear();
    shopFn.mockResolvedValueOnce(found(501));
    expect((await downloadAll(session, ORDER).catch((e) => e)).fields).toEqual({
      form: SHOP_CONFLICTS.zipTooBig,
    });
    shopFn.mockResolvedValueOnce(found(0));
    expect((await downloadAll(session, ORDER).catch((e) => e)).code).toBe("not_found");
    expect(storageGuard).not.toHaveBeenCalled();
  });
});

describe("printFiles (the studio's)", () => {
  it("zips the photos left to print and a manifest with no names", async () => {
    writeRpc.mockResolvedValue({
      data: {
        reference: "7KQ2M9XA",
        files: [
          {
            position: 1,
            job_id: JOB,
            photo_id: P1,
            kind: "print",
            name: "8x10 print",
            print_size: "8x10",
            quantity: 2,
            contents: [],
          },
          {
            position: 2,
            job_id: null,
            photo_id: null,
            kind: "package",
            name: "=cmd|evil",
            print_size: null,
            quantity: 1,
            contents: [{ print_size: "5x7", quantity: 2 }],
          },
        ],
      },
      error: null,
    });
    heads.add(key(P1));
    const zip = await body(await printFiles("ca", "actor", STUDIO, ORDER));
    expect(writeRpc).toHaveBeenCalledWith("ca", "order_print_files", "actor", {
      p_studio_id: STUDIO,
      p_order_id: ORDER,
    });
    const names = entryNames(zip);
    expect(names).toHaveLength(2);
    expect(names[1]).toBe("manifest.csv");
    const csv = zip.toString();
    expect(csv).toContain("5x7 x2");
    // A formula in a product name is never run by a spreadsheet.
    expect(csv).not.toMatch(/,=cmd/);
  });

  it("asks for missing photos through the studio's own function", async () => {
    writeRpc
      .mockResolvedValueOnce({
        data: {
          reference: "7KQ2M9XA",
          files: [
            {
              position: 1,
              job_id: JOB,
              photo_id: P1,
              kind: "print",
              name: "Print",
              print_size: "8x10",
              quantity: 1,
              contents: [],
            },
          ],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { queued: [P1], unavailable: 0 }, error: null });
    expect(await printFiles("ca", "actor", STUDIO, ORDER).catch((e) => e)).toBeInstanceOf(
      ConflictLater,
    );
    expect(writeRpc.mock.calls[1]?.slice(1)).toEqual([
      "order_print_files_to_make",
      "actor",
      { p_studio_id: STUDIO, p_order_id: ORDER, p_photo_ids: [P1] },
    ]);
  });
});
