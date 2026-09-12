import type { NextConfig } from "next";

const projectRoot = __dirname;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: { "/*": ["./.env", "./.env.*", "./data/uploads/**/*", "./data/automation-screenshots/**/*"] },
  onDemandEntries: {
    maxInactiveAge: 15 * 1000,
    pagesBufferLength: 1,
  },
  // Next.js 16 blocks cross-origin requests to dev resources by default.
  // When the dev server is reached via a LAN IP (e.g. from another device
  // on the same Wi-Fi, or via Tailscale), the JS bundle and HMR client get
  // blocked and the page never hydrates — forms then fall back to native GET
  // submission, which is what caused sign-in to leak credentials into the URL.
  //
  // CIDR ranges are NOT supported by this config (Next.js parses entries as
  // hostnames/IPs/wildcards). Use a wildcard for each private-IP class instead.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.18.10",
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.2*.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],
  serverExternalPackages: [
    "mammoth",
    "pdf-parse",
    "pdfjs-dist",
    "word-extractor",
  ],
  webpack(config, { dev }) {
    if (dev) {
      const ignored = config.watchOptions?.ignored;
      const artifacts = /(?:^|[/\\])(?:output[/\\]playwright|\.playwright-cli)(?:[/\\]|$)/;
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ignored instanceof RegExp
          ? new RegExp(`${ignored.source}|${artifacts.source}`, ignored.flags)
          : [...(Array.isArray(ignored) ? ignored : ignored ? [ignored] : []), "**/output/playwright/**", "**/.playwright-cli/**"],
      };
    }
    return config;
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
