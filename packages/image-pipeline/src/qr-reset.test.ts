import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A decoder abort leaves zxing's WebAssembly instance unusable: the module is dropped and loaded again from disk for
// the next photo, so a warm Lambda recovers (ADR 0018; security review 8). zxing-wasm is mocked here; qr.test.ts uses
// the real one.
const zxing = vi.hoisted(() => ({
  prepareZXingModule: vi.fn(async () => undefined),
  purgeZXingModule: vi.fn(),
  readBarcodes: vi.fn(),
}));
vi.mock("zxing-wasm/reader", async (actual) => ({
  ...(await actual<typeof import("zxing-wasm/reader")>()),
  ...zxing,
}));

const { loadQrReader, readCard } = await import("./qr");
const WASM = createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm");
const pixels = { data: new Uint8Array(16), width: 2, height: 2 };

describe("recovering from a decoder abort", () => {
  beforeEach(() => vi.clearAllMocks());

  it("drops the module after an abort and loads it again for the next photo", async () => {
    zxing.readBarcodes.mockRejectedValueOnce(new Error("RuntimeError: Aborted()"));
    const first = await loadQrReader(WASM);
    expect(zxing.prepareZXingModule).toHaveBeenCalledTimes(1);
    // The photo whose decode aborted is unreadable (the photos after it are flagged), never "no card".
    expect(await readCard(first, pixels, null)).toEqual({ kind: "unreadable" });
    expect(zxing.purgeZXingModule).toHaveBeenCalledTimes(1);
    // A reader from before the abort never calls the dropped module (zxing-wasm would fetch one from its CDN).
    await expect(first(pixels)).rejects.toThrow();
    expect(zxing.readBarcodes).toHaveBeenCalledTimes(1);

    zxing.readBarcodes.mockResolvedValueOnce([]);
    const next = await loadQrReader(WASM);
    expect(zxing.prepareZXingModule).toHaveBeenCalledTimes(2);
    expect(await readCard(next, pixels, null)).toEqual({ kind: "none" });
  });

  it("keeps the module while decodes succeed", async () => {
    zxing.readBarcodes.mockResolvedValue([]);
    const a = await loadQrReader(WASM);
    await a(pixels);
    await loadQrReader(WASM);
    expect(zxing.prepareZXingModule).toHaveBeenCalledTimes(0);
    expect(zxing.purgeZXingModule).not.toHaveBeenCalled();
  });
});
