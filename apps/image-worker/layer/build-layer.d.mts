// Types for build-layer.mjs (plain JavaScript so CI and the deploy workflow run it with Node alone).
type Pinned = { name: string; sha256: string };
export declare const FFMPEG_RELEASE: string;
export declare const FFMPEG_FILES: {
  arm64: { gz: Pinned; binary: string; license: Pinned; readme: Pinned };
  x64: { gz: Pinned; binary: string };
};
export declare const PACKAGER_FILES: { arm64: Pinned; x64: Pinned };
export declare const LAMBDA_UNZIPPED_LIMIT: number;
export declare function tools(
  arch: "arm64" | "x64",
  out: string,
): Promise<{ ffmpeg: string; packager: string; packagerLicense: Buffer }>;
