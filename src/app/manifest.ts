import type { MetadataRoute } from "next";
import { THEME } from "./theme";

/** Lets staff install the app on their phone's home screen (My Day opens first for doctors). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "منصة العيادات — Clinic Platform (Demo)",
    short_name: "العيادة",
    description: "Clinic workflow demo — fake data only",
    start_url: "/my-day",
    scope: "/",
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    orientation: "portrait",
    background_color: THEME.background,
    theme_color: THEME.brand,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
