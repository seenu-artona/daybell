import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const config: NextConfig = {
  // Internal packages ship TypeScript source; Next compiles them (D7).
  transpilePackages: ["@daybell/api", "@daybell/config", "@daybell/core", "@daybell/ui"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(config);
