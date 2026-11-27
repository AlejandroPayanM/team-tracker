import { pwaIcon } from "@/lib/pwa-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS recorta las esquinas por su cuenta: se entrega el cuadrado completo.
export default function AppleIcon() {
  return pwaIcon(180, true);
}
