import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team Tracker",
  description: "Seguimiento de PRs y trabajo del equipo",
  robots: { index: false, follow: false },
};

// Responsivo y con el color de la barra del navegador móvil acorde al menú.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
