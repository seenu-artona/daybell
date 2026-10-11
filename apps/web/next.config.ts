import type { NextConfig } from "next";

const config: NextConfig = {
  // Internal packages ship TypeScript source; Next compiles them (D7).
  transpilePackages: ["@daybell/config", "@daybell/core"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
