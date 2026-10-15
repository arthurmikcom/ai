import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Embedded PostgreSQL for local development ships WebAssembly files that
  // must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
  // Second line of defence for model output: images may only come from this site.
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "img-src 'self' data: blob:" }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
