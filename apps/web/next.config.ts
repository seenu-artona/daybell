import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// The local storage driver is for development, CI and end-to-end tests only (ADR 0016): any Vercel build (production,
// preview or staging) that would use it fails here, before it can be deployed.
if (process.env.STORAGE_DRIVER === "local" && (process.env.VERCEL || process.env.VERCEL_ENV))
  throw new Error("STORAGE_DRIVER=local is not allowed on Vercel");
// The same for the fake Stripe (ADR 0020).
if (process.env.STRIPE_DRIVER === "fake" && (process.env.VERCEL || process.env.VERCEL_ENV))
  throw new Error("STRIPE_DRIVER=fake is not allowed on Vercel");

const config: NextConfig = {
  // Internal packages ship TypeScript source; Next compiles them (D7).
  transpilePackages: [
    "@daybell/api",
    "@daybell/config",
    "@daybell/core",
    "@daybell/image-pipeline",
    "@daybell/storage",
    "@daybell/ui",
  ],
  // The QR card PDF (ADR 0015): pdfkit and fontkit load their own files at run time, so they stay plain Node modules
  // rather than being bundled.
  // sharp (the local storage driver's previews, ADR 0016) loads a native library; zxing-wasm (its QR reading, ADR
  // 0018) is given its .wasm file from disk.
  serverExternalPackages: ["pdfkit", "fontkit", "sharp", "zxing-wasm"],
  // The fonts the QR card PDF embeds, read from disk by the route that builds it.
  outputFileTracingIncludes: { "/api/v1/jobs/[id]/qr-cards": ["./assets/fonts/*.ttf"] },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(config);
