import { describe, expect, it } from "vitest";
import {
  DRM_MANIFEST_VARIANT,
  DRM_VARIANTS,
  drmClipSize,
  drmIvHex,
  guidBytes,
  H264_LEVEL_40_MAX_MACROBLOCKS,
  isDrmKeyId,
  rewriteDashManifest,
  rewriteHlsMaster,
  rewriteHlsMedia,
} from "./drm";
import { PHOTO_VARIANTS, parsePhotoKey, photoKey } from "./photos";

const KEY_ID = "2b0e6a4c-9f6e-4f0a-8d2b-3c4d5e6f7a8b";
const mbs = (s: { width: number; height: number }) =>
  Math.ceil(s.width / 16) * Math.ceil(s.height / 16);

describe("drmClipSize (H.264 High, level 4.0)", () => {
  it("keeps a 3:2 proof's size, made even (1600×1067 → 1600×1066)", () => {
    expect(drmClipSize(1600, 1067)).toEqual({ width: 1600, height: 1066 });
    expect(drmClipSize(1067, 1600)).toEqual({ width: 1066, height: 1600 });
    expect(drmClipSize(1600, 1066)).toEqual({ width: 1600, height: 1066 });
  });

  it("shrinks a square proof until it fits 8,192 macroblocks, keeping its shape", () => {
    const size = drmClipSize(1600, 1600);
    expect(mbs(size)).toBeLessThanOrEqual(H264_LEVEL_40_MAX_MACROBLOCKS);
    expect(size.width).toBe(size.height);
    expect(size.width).toBeGreaterThan(1400);
  });

  it("never enlarges, and every size is even and within level 4.0", () => {
    for (const [w, h] of [
      [3, 3],
      [401, 267],
      [1600, 1200],
      [1600, 400],
      [5000, 300],
      [1600, 1599],
    ] as const) {
      const size = drmClipSize(w, h);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
      expect(size.width).toBeLessThanOrEqual(w);
      expect(size.height).toBeLessThanOrEqual(h);
      expect(mbs(size)).toBeLessThanOrEqual(H264_LEVEL_40_MAX_MACROBLOCKS);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
    }
    expect(() => drmClipSize(1, 100)).toThrow();
    expect(() => drmClipSize(10.5, 100)).toThrow();
  });
});

describe("key IDs and the IV (B2; the spike's FairPlay finding)", () => {
  it("are random v4 GUIDs, lower-case with dashes", () => {
    expect(isDrmKeyId(KEY_ID)).toBe(true);
    expect(isDrmKeyId(crypto.randomUUID())).toBe(true);
    expect(isDrmKeyId(KEY_ID.toUpperCase())).toBe(false);
    expect(isDrmKeyId(KEY_ID.replaceAll("-", ""))).toBe(false);
    expect(isDrmKeyId("2b0e6a4c-9f6e-1f0a-8d2b-3c4d5e6f7a8b")).toBe(false);
  });

  it("the IV is the key ID's own 16 bytes, in written order", () => {
    expect(drmIvHex(KEY_ID)).toBe("2b0e6a4c9f6e4f0a8d2b3c4d5e6f7a8b");
    const bytes = guidBytes(KEY_ID);
    expect(bytes.length).toBe(16);
    expect(bytes[0]).toBe(0x2b);
    expect(bytes[15]).toBe(0x8b);
    expect(() => drmIvHex("nope")).toThrow();
  });
});

describe("storage keys", () => {
  it("adds the clip and its three manifests beside the previews (ids only)", () => {
    const ids = {
      studioId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      photoId: crypto.randomUUID(),
    };
    for (const variant of DRM_VARIANTS) {
      expect(PHOTO_VARIANTS).toContain(variant);
      expect(parsePhotoKey(photoKey(ids, variant))?.variant).toBe(variant);
    }
    expect(Object.values(DRM_MANIFEST_VARIANT).sort()).toEqual(
      ["drm-video.m3u8", "drm.m3u8", "drm.mpd"].sort(),
    );
  });
});

// The packager's own output (Shaka Packager 3.9.3, single file, on demand), trimmed.
const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period id="0">
    <AdaptationSet id="0" contentType="video">
      <Representation id="0" codecs="avc1.640028" mimeType="video/mp4">
        <BaseURL>drm.mp4</BaseURL>
        <SegmentBase indexRange="1495-1538" timescale="10240"><Initialization range="0-1494"/></SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;
const MASTER = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-STREAM-INF:BANDWIDTH=2431080,CODECS="avc1.640028",RESOLUTION=1600x1066
drm-video.m3u8
`;
const MEDIA = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:2
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="drm.mp4",BYTERANGE="1495@0"
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://${KEY_ID}",KEYFORMATVERSIONS="1",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:2.000,
#EXT-X-BYTERANGE:60777@1539
drm.mp4
#EXT-X-ENDLIST
`;
const SIGNED =
  "https://bucket.s3.ca-central-1.amazonaws.com/s/j/p/drm.mp4?X-Amz-Expires=600&X-Amz-Signature=abc";

describe("manifest rewriting", () => {
  it("DASH: the one BaseURL becomes the signed address, & escaped", () => {
    const out = rewriteDashManifest(MPD, SIGNED);
    expect(out).toContain(
      "<BaseURL>https://bucket.s3.ca-central-1.amazonaws.com/s/j/p/drm.mp4?X-Amz-Expires=600&amp;X-Amz-Signature=abc</BaseURL>",
    );
    expect(out).not.toContain("<BaseURL>drm.mp4</BaseURL>");
    expect(out.replace(/<BaseURL>[^<]*<\/BaseURL>/, "")).toBe(
      MPD.replace("<BaseURL>drm.mp4</BaseURL>", ""),
    );
  });

  it("HLS: the master's variant points back at the route; the media playlist's map and segment are signed", () => {
    const route = "/api/v1/shop/children/c/photos/p/drm-manifest?format=hls-media&gallery=g";
    expect(rewriteHlsMaster(MASTER, route)).toContain(`\n${route}\n`);
    const media = rewriteHlsMedia(MEDIA, SIGNED);
    expect(media).toContain(`#EXT-X-MAP:URI="${SIGNED}",BYTERANGE="1495@0"`);
    expect(media).toContain(`#EXT-X-BYTERANGE:60777@1539\n${SIGNED}\n`);
    expect(media).toContain(`URI="skd://${KEY_ID}"`);
    expect(media).not.toMatch(/^drm\.mp4$/m);
  });

  it("refuses anything that isn't the packager's manifest, or an address that would break a line", () => {
    expect(() => rewriteDashManifest("<MPD/>", SIGNED)).toThrow();
    expect(() =>
      rewriteDashManifest(MPD.replace("</Period>", "<BaseURL>drm.mp4</BaseURL></Period>"), SIGNED),
    ).toThrow();
    expect(() => rewriteHlsMaster("#EXTM3U\n", "/x")).toThrow();
    expect(() => rewriteHlsMaster(MASTER, "/x\n#EXT-X-ENDLIST")).toThrow();
    expect(() => rewriteHlsMedia(MEDIA, `${SIGNED}"`)).toThrow();
  });
});
