import { describe, expect, it } from "vitest";
import {
  DRM_MANIFEST_VARIANT,
  DRM_VARIANTS,
  DrmManifestError,
  drmClipSize,
  drmIvHex,
  drmObjectKey,
  drmPrefix,
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

describe("storage keys (review H1)", () => {
  const ids = {
    studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
    photoId: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
  };
  it("keeps each key's files under its own name in the photo's drm/ folder (ids only)", () => {
    const prefix = `${ids.studioId}/${ids.jobId}/${ids.photoId}/drm/${KEY_ID}`;
    expect(DRM_VARIANTS.map((v) => drmObjectKey(ids, KEY_ID, v))).toEqual([
      `${prefix}.mp4`,
      `${prefix}.mpd`,
      `${prefix}.m3u8`,
      `${prefix}-video.m3u8`,
    ]);
    expect(drmPrefix(ids)).toBe(`${ids.studioId}/${ids.jobId}/${ids.photoId}/drm/`);
    // Two runs, two keys: never the same object.
    const other = "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    expect(drmObjectKey(ids, other, "drm.mp4")).not.toBe(drmObjectKey(ids, KEY_ID, "drm.mp4"));
    expect(() => drmObjectKey(ids, "../x", "drm.mp4")).toThrow();
    // They are inside the photo's folder (purged with it) and never a photo variant the worker would act on.
    expect(
      drmObjectKey(ids, KEY_ID, "drm.mp4").startsWith(
        photoKey(ids, "original").replace("original", ""),
      ),
    ).toBe(true);
    expect(parsePhotoKey(drmObjectKey(ids, KEY_ID, "drm.mp4"))).toBeNull();
    expect(PHOTO_VARIANTS).not.toContain("drm.mp4");
    expect(Object.values(DRM_MANIFEST_VARIANT).sort()).toEqual(
      ["drm-video.m3u8", "drm.m3u8", "drm.mpd"].sort(),
    );
  });
});

// The packager's own output (Shaka Packager 3.9.3, single file, on demand), trimmed.
const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<!--Generated with https://github.com/shaka-project/shaka-packager version v3.9.3-0a8ba4f-release-->
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" type="static">
  <Period id="0">
    <AdaptationSet id="0" contentType="video">
      <ContentProtection value="cbcs" schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="${KEY_ID}"/>
      <Representation id="0" codecs="avc1.640028" mimeType="video/mp4">
        <BaseURL>drm.mp4</BaseURL>
        <SegmentBase indexRange="1495-1538" timescale="10240"><Initialization range="0-1494"/></SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;
const MASTER = `#EXTM3U
## Generated with https://github.com/shaka-project/shaka-packager version v3.9.3-0a8ba4f-release

#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-STREAM-INF:BANDWIDTH=2431080,AVERAGE-BANDWIDTH=2431080,CODECS="avc1.640028",RESOLUTION=1600x1066,FRAME-RATE=5.000,VIDEO-RANGE=SDR,CLOSED-CAPTIONS=NONE
drm-video.m3u8
`;
const HEX = KEY_ID.replaceAll("-", "");
const MEDIA = `#EXTM3U
#EXT-X-VERSION:6
## Generated with https://github.com/shaka-project/shaka-packager version v3.9.3-0a8ba4f-release
#EXT-X-TARGETDURATION:2
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="drm.mp4",BYTERANGE="1495@0"
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;charset=UTF-16;base64,vgEAAA==",IV=0x${HEX},KEYFORMATVERSIONS="1",KEYFORMAT="com.microsoft.playready"
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,AAAAOHBzc2g=",KEYID=0x${HEX},IV=0x${HEX},KEYFORMATVERSIONS="1",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://${KEY_ID}",KEYFORMATVERSIONS="1",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:2.000,
#EXT-X-BYTERANGE:60777@1539
drm.mp4
#EXT-X-ENDLIST
`;
const SIGNED =
  "https://bucket.s3.ca-central-1.amazonaws.com/s/j/p/drm/k.mp4?X-Amz-Expires=600&X-Amz-Signature=abc";
const OTHER = "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

describe("manifest rewriting (strict; review H1, tester #10)", () => {
  it("DASH: the one BaseURL becomes the signed address, & escaped", () => {
    const out = rewriteDashManifest(MPD, SIGNED, KEY_ID);
    expect(out).toContain(
      "<BaseURL>https://bucket.s3.ca-central-1.amazonaws.com/s/j/p/drm/k.mp4?X-Amz-Expires=600&amp;X-Amz-Signature=abc</BaseURL>",
    );
    expect(out.replace(/<BaseURL>[^<]*<\/BaseURL>/, "")).toBe(
      MPD.replace("<BaseURL>drm.mp4</BaseURL>", ""),
    );
  });

  it("DASH: refused for another key, a second BaseURL or another file", () => {
    expect(() => rewriteDashManifest(MPD, SIGNED, OTHER)).toThrow(DrmManifestError);
    expect(() =>
      rewriteDashManifest(
        MPD.replace("</Period>", "<BaseURL>drm.mp4</BaseURL></Period>"),
        SIGNED,
        KEY_ID,
      ),
    ).toThrow(DrmManifestError);
    expect(() =>
      rewriteDashManifest(MPD.replace(">drm.mp4<", ">x.mp4<"), SIGNED, KEY_ID),
    ).toThrow();
    expect(() => rewriteDashManifest("<MPD/>", SIGNED, KEY_ID)).toThrow();
  });

  it("HLS master: exactly one variant, pointed back at the route", () => {
    const route = "/api/v1/shop/children/c/photos/p/drm-manifest?format=hls-media&gallery=g";
    const out = rewriteHlsMaster(MASTER, route);
    expect(out.split("\n").filter(Boolean).at(-1)).toBe(route);
    expect(out).toContain("#EXT-X-STREAM-INF:");
    expect(out).not.toContain("drm-video.m3u8");
    for (const bad of [
      `${MASTER}#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.640028"\nother.m3u8\n`,
      MASTER.replace("drm-video.m3u8", "https://evil.example/x.m3u8"),
      MASTER.replace("#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-SESSION-KEY:URI=x"),
      "#EXTM3U\n",
    ])
      expect(() => rewriteHlsMaster(bad, route)).toThrow(DrmManifestError);
    expect(() => rewriteHlsMaster(MASTER, "/x\n#EXT-X-ENDLIST")).toThrow();
  });

  it("HLS media: the map and the one segment signed, its keys kept, for the expected key only", () => {
    const media = rewriteHlsMedia(MEDIA, SIGNED, KEY_ID);
    expect(media).toContain(`#EXT-X-MAP:URI="${SIGNED}",BYTERANGE="1495@0"`);
    expect(media).toContain(`#EXT-X-BYTERANGE:60777@1539\n${SIGNED}\n`);
    expect(media).toContain(`URI="skd://${KEY_ID}"`);
    expect(media).not.toMatch(/^drm\.mp4$/m);
    expect(() => rewriteHlsMedia(MEDIA, SIGNED, OTHER)).toThrow(DrmManifestError);
    for (const bad of [
      MEDIA.replace(
        "#EXT-X-ENDLIST",
        "#EXTINF:2.000,\n#EXT-X-BYTERANGE:1@2\ndrm.mp4\n#EXT-X-ENDLIST",
      ),
      MEDIA.replace(`KEYID=0x${HEX}`, `KEYID=0x${OTHER.replaceAll("-", "")}`),
      MEDIA.replace('URI="drm.mp4"', 'URI="https://evil.example/x.mp4"'),
      MEDIA.replace("#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-PLAYLIST-TYPE:EVENT"),
      MEDIA.replace(
        `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://${KEY_ID}"`,
        `#EXT-X-KEY:METHOD=AES-128,URI="skd://${KEY_ID}"`,
      ),
    ])
      expect(() => rewriteHlsMedia(bad, SIGNED, KEY_ID)).toThrow(DrmManifestError);
    expect(() => rewriteHlsMedia(MEDIA, `${SIGNED}"`, KEY_ID)).toThrow();
  });
});
