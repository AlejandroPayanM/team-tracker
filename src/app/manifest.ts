import type { MetadataRoute } from "next";

// Permite instalar la app en la pantalla de inicio del celular y abrirla sin la barra del navegador.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Team Tracker",
    short_name: "Team Tracker",
    description: "Seguimiento de PRs y trabajo del equipo",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f6fa",
    theme_color: "#ffffff",
    lang: "es",
    icons: [
      { src: "/pwa-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
