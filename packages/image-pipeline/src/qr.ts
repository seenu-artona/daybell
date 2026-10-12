import { readFile } from "node:fs/promises";
import { classifyQr, type QrReading, type QrSymbol } from "@daybell/core";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

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

const loaded = new Map<string, Promise<void>>();

/**
 * A reader backed by zxing's reader .wasm at `wasmFile` (always given by the caller: the Lambda's copy next to its
 * bundle, the web app's node_modules for the local driver, node_modules in tests; never resolved here, so bundlers
 * never try to bundle it), instantiated once per process. A file that can't be read or instantiated throws: the photo's
 * message goes back to the queue rather than being processed without cards.
 */
export async function loadQrReader(wasmFile: string): Promise<QrReader> {
  let ready = loaded.get(wasmFile);
  if (!ready) {
    ready = (async () => {
      const bytes = await readFile(wasmFile);
      const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
    })();
    loaded.set(wasmFile, ready);
    ready.catch(() => loaded.delete(wasmFile));
  }
  await ready;
  return async (image) => {
    const results = await readBarcodes(
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
    return results.map((r) => ({ valid: r.isValid, text: r.isValid ? r.text : "" }));
  };
}

/**
 * Reads a photo's card: first from the decoded preview-sized image (about 2048 px); only when a symbol is located but
 * can't be read, again from a larger decode (about 3000 px), which `larger` makes on demand. A decoder error on one
 * photo counts as unreadable, so the photos after it are flagged rather than silently given to someone.
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
      if (big) symbols = await reader(big);
    }
    return classifyQr(symbols);
  } catch {
    return { kind: "unreadable" };
  }
}
