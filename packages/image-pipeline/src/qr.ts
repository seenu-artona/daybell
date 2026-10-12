import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { classifyQr, parseCardQrPayload, type QrReading, type QrSymbol } from "@daybell/core";
import {
  prepareZXingModule,
  purgeZXingModule,
  readBarcodes,
  ZXING_WASM_SHA256,
} from "zxing-wasm/reader";

/**
 * Reading QR cards in photos (Phase 1 step 5; D32, F16; ADR 0018), in the image worker, in the studio's region (D113).
 * zxing-cpp compiled to WebAssembly (zxing-wasm, MIT), so the same code runs on the Lambda's arm64 Node 22 and on any
 * developer machine. Its .wasm file is always read from disk: by default the library would fetch it from a CDN, which
 * a Lambda in Canada must never depend on. Never logs, and the card code read is only ever returned to the caller.
 */

/** RGBA pixels, as zxing's ImageData path takes them (it converts to luminance itself). */
export interface RgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Finds the QR symbols in an image: decoded ones, and ones located but not decoded. */
export type QrReader = (image: RgbaImage) => Promise<QrSymbol[]>;

/** At most this many symbols per photo: a card, maybe a second card, and a stray code on a T-shirt. */
const MAX_SYMBOLS = 4;

/**
 * zxing-wasm 3.1.4's reader .wasm, pinned (apps/image-worker/scripts/build.mjs pins the same value). Checked every
 * time the file is loaded, not only at build: a different file next to the bundle never runs.
 */
export const ZXING_READER_SHA256 =
  "e8af31edb56d0522f4de74495839385ef019ba8bc90d38e5ecb2f18795d86fb2";

/** The module, once loaded: one per process (zxing-wasm keeps a single module). */
let loaded: { file: string; ready: Promise<void>; generation: number } | null = null;
/** Goes up each time the module is dropped, so a reader made before never calls a dropped module. */
let generation = 0;

/** Forgets the module after a decoder abort: the next photo loads it again from disk (a warm Lambda recovers). */
function dropModule() {
  generation++;
  loaded = null;
  purgeZXingModule();
}

/**
 * A reader backed by zxing's reader .wasm at `wasmFile` (always given by the caller: the Lambda's copy next to its
 * bundle, the web app's node_modules for the local driver, node_modules in tests; never resolved here, so bundlers
 * never try to bundle it), instantiated once per process. A file that can't be read, doesn't match its pinned SHA-256
 * or can't be instantiated throws: the photo's message goes back to the queue rather than being processed without
 * cards. A decoder error drops the module, so the next photo starts from a fresh one.
 */
export async function loadQrReader(wasmFile: string): Promise<QrReader> {
  if (!loaded || loaded.file !== wasmFile) {
    const ready = (async () => {
      const bytes = await readFile(wasmFile);
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (sha !== ZXING_READER_SHA256 || sha !== ZXING_WASM_SHA256)
        throw new Error("zxing_reader.wasm doesn't match its pinned SHA-256");
      const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
    })();
    const entry = { file: wasmFile, ready, generation };
    loaded = entry;
    ready.catch(() => {
      if (loaded === entry) loaded = null;
    });
  }
  const { ready, generation: mine } = loaded;
  await ready;
  return async (image) => {
    // Never call a module that was dropped: zxing-wasm would otherwise fetch a new one from its CDN.
    if (mine !== generation) throw new Error("The QR reader was reset");
    let results: Awaited<ReturnType<typeof readBarcodes>>;
    try {
      results = await readBarcodes(
        { data: image.data, width: image.width, height: image.height } as unknown as ImageData,
        {
          formats: ["QRCode"],
          tryHarder: true,
          tryRotate: true,
          tryInvert: false,
          // Symbols found but not decoded come back with isValid false: "looks like a card" (Seenu, answer 1).
          returnErrors: true,
          maxNumberOfSymbols: MAX_SYMBOLS,
        },
      );
    } catch (err) {
      // An abort leaves the WebAssembly instance unusable: drop it (once) so the next photo gets a fresh one.
      if (mine === generation) dropModule();
      throw err;
    }
    return results.map((r) => ({ valid: r.isValid, text: r.isValid ? r.text : "" }));
  };
}

/** A cleanly read Daybell card among the symbols. */
const hasCard = (symbols: readonly QrSymbol[]) =>
  symbols.some((s) => s.valid && parseCardQrPayload(s.text) !== null);

/**
 * Reads a photo's card: first from the decoded preview-sized image (about 2048 px); only when a symbol is located but
 * can't be read, again from a larger decode (about 3000 px), which `larger` makes on demand. The larger pass replaces
 * the first only when it reads a card cleanly (it sees the same scene in more detail); otherwise both passes' symbols
 * count, so a "looks like a card" from the first pass is never lost (Seenu, answer 1: never silently mis-tagged). A decoder
 * error on one photo counts as unreadable, so the photos after it are flagged rather than silently given to someone.
 */
export async function readCard(
  reader: QrReader,
  image: RgbaImage,
  larger: (() => Promise<RgbaImage | null>) | null,
): Promise<QrReading> {
  try {
    let symbols = await reader(image);
    if (larger && symbols.some((s) => !s.valid)) {
      const big = await larger();
      if (big) {
        const again = await reader(big);
        symbols = hasCard(again) ? again : [...symbols, ...again];
      }
    }
    return classifyQr(symbols);
  } catch {
    return { kind: "unreadable" };
  }
}
