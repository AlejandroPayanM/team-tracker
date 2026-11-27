import { ImageResponse } from "next/og";

/**
 * Ícono de la app (para «Agregar a pantalla de inicio»): fondo índigo con tres barras.
 * `maskable` deja el dibujo dentro de la zona segura (el sistema recorta las orillas en círculo o squircle).
 */
export function pwaIcon(size: number, maskable = false): ImageResponse {
  const art = size * (maskable ? 0.46 : 0.56);
  const bar = art * 0.24;
  const heights = [0.5, 0.8, 1];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #6366f1 0%, #4338ca 100%)",
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", width: art, height: art }}>
          {heights.map((h) => (
            <div key={h} style={{ width: bar, height: art * h, background: "#ffffff", borderRadius: bar * 0.3 }} />
          ))}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
