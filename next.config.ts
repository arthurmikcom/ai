import type { NextConfig } from "next";

/** Where an admin's own map tiles (NEXT_PUBLIC_MAP_TILES) come from. */
function tilesOrigin(): string {
  const template = process.env.NEXT_PUBLIC_MAP_TILES?.trim();
  if (!template) return "";
  try {
    const { protocol, host } = new URL(template.replace(/\{s\}/g, "a"));
    return protocol === "https:" ? `${protocol}//${host.replace(/^a\./, "*.")}` : "";
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Embedded PostgreSQL for local development ships WebAssembly files that
  // must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
  // Second line of defence for model output: images may only come from this
  // site (and the map tiles of «Карты»).
  async headers() {
    const img = ["'self'", "data:", "blob:", "https://basemaps.cartocdn.com", "https://*.basemaps.cartocdn.com", "https://api.mapbox.com", "https://tile.openstreetmap.org", "https://tile.openstreetmap.de", tilesOrigin()].filter(Boolean).join(" ");
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: `img-src ${img}` }] }];
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
