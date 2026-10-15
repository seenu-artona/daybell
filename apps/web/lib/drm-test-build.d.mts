// Types for drm-test-build.mjs (plain JavaScript so the build runs it with Node alone).
type Env = Record<string, string | undefined>;

export declare const GENERATED: readonly string[];
export declare const SEGMENT_SECONDS: number;
export declare const PACKAGER_SHA256: Readonly<Record<string, string>>;

export declare function guidSetting(name: string, value: string | undefined): string;

export type BuildPlan =
  | { action: "skip"; reason: "disabled" | "production" | "missingKeys" }
  | { action: "encrypt"; keyId: string; keyIdHex: string; contentKeyHex: string };
export declare function buildPlan(env: Env): BuildPlan;

export declare function scrub(text: unknown, secrets: readonly string[]): string;
export declare function removeGenerated(outDir: string, remove?: (path: string) => void): void;
export declare function packagerFileName(platform: string, arch: string): string | null;
export declare function verifyPackager(name: string, bytes: Uint8Array): void;
export declare function packagerEnv(env: Env): { PATH: string };
export declare function packagerArgs(input: {
  clear: string;
  out: string;
  keyId: string;
  keyIdHex: string;
  contentKeyHex: string;
}): string[];
