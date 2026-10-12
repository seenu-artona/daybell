import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const config: NextConfig = {
  // Internal packages ship TypeScript source; Next compiles them (D7).
  transpilePackages: ["@daybell/api", "@daybell/config", "@daybell/core", "@daybell/ui"],
  // The QR card PDF (ADR 0015): pdfkit and fontkit load their own files at run time, so they stay plain Node modules
  // rather than being bundled.
  serverExternalPackages: ["pdfkit", "fontkit"],
  // The fonts the QR card PDF embeds, read from disk by the route that builds it.
  outputFileTracingIncludes: { "/api/v1/jobs/[id]/qr-cards": ["./assets/fonts/*.ttf"] },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(config);
