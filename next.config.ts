import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js inyecta scripts inline para hidratación; en dev también requiere eval.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Permite compilar/probar en otra carpeta (NEXT_DIST_DIR=.next-test) sin pisar el servidor de desarrollo en uso.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Se cargan como paquetes de Node (no empaquetados): pdfkit lee sus fuentes de disco y exceljs es muy grande.
  serverExternalPackages: ["exceljs", "pdfkit"],
  // pdfkit carga sus fuentes estándar con require dinámico (createRequire), que el rastreo de archivos no detecta:
  // sin esto el PDF funciona en local pero falla en Vercel por no encontrar Helvetica.
  outputFileTracingIncludes: {
    "/api/reports/export": ["./node_modules/pdfkit/js/standard-fonts/**/*", "./node_modules/pdfkit/js/data/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
