import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team Tracker",
  description: "Seguimiento de PRs y trabajo del equipo",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
