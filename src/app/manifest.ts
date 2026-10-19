import type { MetadataRoute } from "next";

/** Makes MARYX installable as an app (home screen on phones, its own window on computers). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MARYX Ai",
    short_name: "MARYX",
    description: "Собственный искусственный интеллект: чат, картинки, видео и обработка фото.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    lang: "ru",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
