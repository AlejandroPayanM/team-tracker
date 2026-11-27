import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team Tracker",
  description: "Seguimiento de PRs y trabajo del equipo",
  robots: { index: false, follow: false },
  // Al agregarla a la pantalla de inicio del iPhone/iPad se abre como app, con su propio nombre.
  appleWebApp: { capable: true, title: "Team Tracker", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

// Responsivo, con el color de la barra del navegador móvil acorde a la barra superior y usando toda la pantalla
// (la app respeta las zonas del notch y de la barra de gestos con env(safe-area-inset-*)).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
