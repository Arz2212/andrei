import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Система жизни — Life OS",
    short_name: "Life OS",
    description: "Персональная система управления делами, фокусом, финансами и состоянием",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F6F2",
    theme_color: "#215E48",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
