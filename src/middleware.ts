import { NextResponse, type NextRequest } from "next/server";

// Primera barrera: sin cookie de sesión no se llega a ninguna página.
// La validación real de la sesión (BD) ocurre en cada página/acción con requireUser().
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-tt_session" : "tt_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/cron/")) return NextResponse.next();
  if (!req.cookies.get(COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
