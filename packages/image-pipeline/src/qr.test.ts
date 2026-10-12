import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cardQrPayload } from "@daybell/core";
import QRCode from "qrcode";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { loadQrReader, processOriginal, type QrReader, readCard } from "./index";

// Reading QR cards (ADR 0018). Fixtures are made here: a card's QR (the payload a printed card holds, DBC1: + code)
// composited into a 24-megapixel JPEG, as a camera would take a child holding a card at waist height.
const WASM = createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm");
const CODE = "0123456789ABCDEFGHJK";
const OTHER = "MNPQRSTVWXYZ01234567";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(b.byteLength);
  out.set(b);
  return out;
};

interface Card {
  payload: string;
  /** Side of the QR with its quiet zone, in pixels of the photo. */
  size?: number;
  left?: number;
  top?: number;
  rotate?: number;
  /** Covers this share of the code's middle (data area), leaving its finder patterns visible. */
  damage?: number;
}

async function cardImage(card: Card): Promise<Buffer> {
  const size = card.size ?? 300;
  let png = await QRCode.toBuffer(card.payload, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: size,
  });
  if (card.damage) {
    const band = Math.round(size * card.damage);
    png = await sharp(png)
      .composite([
        {
          input: {
            create: {
              width: Math.round(size * 0.7),
              height: band,
              channels: 3,
              background: "#000",
            },
          },
          left: Math.round(size * 0.15),
          top: Math.round((size - band) / 2),
        },
      ])
      .png()
      .toBuffer();
  }
  if (card.rotate)
    png = await sharp(png).rotate(card.rotate, { background: "#ffffff" }).png().toBuffer();
  return png;
}

/** A 6000 × 4000 photo (or the given size) with the cards in it. */
async function photo(
  cards: Card[],
  options: { width?: number; height?: number; orientation?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const width = options.width ?? 6000;
  const height = options.height ?? 4000;
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 92, g: 110, b: 128 } },
  }).composite(
    await Promise.all(
      cards.map(async (card, i) => ({
        input: await cardImage(card),
        left: card.left ?? 2600 + i * 900,
        top: card.top ?? 2300,
      })),
    ),
  );
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return asBytes(await image.jpeg({ quality: 90 }).toBuffer());
}

let reader: QrReader;
beforeAll(async () => {
  // The wasm file from node_modules, read from disk (never fetched).
  reader = await loadQrReader(WASM);
});

const read = async (bytes: Uint8Array<ArrayBuffer>) => {
  const result = await processOriginal(bytes, {
    studioName: "North Peak",
    expectedSha256: sha(bytes),
    qrReader: reader,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.facts;
};

describe("reading QR cards in photos (ADR 0018)", () => {
  it("reads a card held in a 24-megapixel photo", async () => {
    const facts = await read(await photo([{ payload: cardQrPayload(CODE) }]));
    expect(facts.qr).toEqual({ kind: "card", cardCode: CODE });
    expect([facts.width, facts.height]).toEqual([6000, 4000]);
  }, 30_000);

  it("reads a card held at an angle", async () => {
    expect((await read(await photo([{ payload: cardQrPayload(CODE), rotate: 25 }]))).qr).toEqual({
      kind: "card",
      cardCode: CODE,
    });
  }, 30_000);

  it("reads a card in a photo turned by its EXIF orientation", async () => {
    const facts = await read(
      await photo([{ payload: cardQrPayload(CODE), left: 900, top: 300 }], {
        width: 4000,
        height: 3000,
        orientation: 6,
      }),
    );
    expect(facts.qr).toEqual({ kind: "card", cardCode: CODE });
    expect([facts.width, facts.height]).toEqual([3000, 4000]);
  }, 30_000);

  it("reads a small card (about 100 px at the decode size) in a big photo", async () => {
    expect((await read(await photo([{ payload: cardQrPayload(CODE), size: 300 }]))).qr.kind).toBe(
      "card",
    );
    expect(
      (await read(await photo([{ payload: cardQrPayload(CODE), size: 200, left: 400, top: 400 }])))
        .qr,
    ).toEqual({ kind: "card", cardCode: CODE });
  }, 30_000);

  it("calls a partly covered card unreadable: found but not read (Seenu, answer 1)", async () => {
    expect((await read(await photo([{ payload: cardQrPayload(CODE), damage: 0.25 }]))).qr).toEqual({
      kind: "unreadable",
    });
  }, 30_000);

  it("ignores a QR code that isn't a Daybell card", async () => {
    expect((await read(await photo([{ payload: "https://example.com/lunch-menu" }]))).qr).toEqual({
      kind: "none",
    });
  }, 30_000);

  it("finds nothing in a photo without a QR code", async () => {
    expect((await read(await photo([]))).qr).toEqual({ kind: "none" });
  }, 30_000);

  it("calls two different cards in one photo unreadable", async () => {
    expect(
      (
        await read(
          await photo([
            { payload: cardQrPayload(CODE), left: 1000 },
            { payload: cardQrPayload(OTHER), left: 4000 },
          ]),
        )
      ).qr,
    ).toEqual({ kind: "unreadable" });
  }, 30_000);

  it("looks again at a larger size only when a symbol was found but not read", async () => {
    const pixels = { data: new Uint8Array(16), width: 2, height: 2 };
    let looks = 0;
    const larger = async () => {
      looks++;
      return pixels;
    };
    const found = async () => [{ valid: false, text: "" }];
    const clean = async () => [{ valid: true, text: cardQrPayload(CODE) }];
    expect(await readCard(clean, pixels, larger)).toEqual({ kind: "card", cardCode: CODE });
    expect(looks).toBe(0);
    let calls = 0;
    const thenClean: QrReader = async () => (calls++ === 0 ? found() : clean());
    expect(await readCard(thenClean, pixels, larger)).toEqual({ kind: "card", cardCode: CODE });
    expect(looks).toBe(1);
    // A decoder error on one photo is never "no card": the photos after it are flagged instead.
    const broken: QrReader = async () => {
      throw new Error("boom");
    };
    expect(await readCard(broken, pixels, null)).toEqual({ kind: "unreadable" });
  });

  it("refuses to start without its wasm file, rather than processing photos without cards", async () => {
    await expect(loadQrReader("/nonexistent/zxing_reader.wasm")).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DAYBELL_PERF)("@perf: processing time with QR reading", () => {
  it("measures p50 and p95 on 24-megapixel photos, with and without reading cards", async () => {
    const bytes = await photo([{ payload: cardQrPayload(CODE) }]);
    const none: QrReader = async () => [];
    const time = async (qrReader: QrReader) => {
      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        await processOriginal(bytes, {
          studioName: "North Peak",
          expectedSha256: sha(bytes),
          qrReader,
        });
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      const p = (q: number) =>
        Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0);
      return `p50 ${p(0.5)} ms, p95 ${p(0.95)} ms`;
    };
    process.stdout.write(`processOriginal 24 MP, reading cards: ${await time(reader)}\n`);
    process.stdout.write(`processOriginal 24 MP, no reader: ${await time(none)}\n`);
  }, 300_000);
});
