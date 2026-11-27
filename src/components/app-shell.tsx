"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/actions";
import { Icon, type IconName } from "@/components/icons";
import { SyncBar, type SyncStatus } from "@/components/sync-bar";
import { TeamSwitcher, type TeamSwitcherProps } from "@/components/team-switcher";

type NavLink = { href: string; label: string; short?: string; icon: IconName; tab?: boolean; only?: "admin" | "manage" | "leaders" };

/** `tab`: va en la barra inferior del celular; el resto vive en la hoja «Más». */
const LINKS: NavLink[] = [
  { href: "/", label: "Resumen", icon: "dashboard", tab: true },
  { href: "/prs", label: "Pull requests", short: "PRs", icon: "pr", tab: true },
  { href: "/team", label: "Personas", icon: "team", tab: true },
  { href: "/reports", label: "Reportes", icon: "report", tab: true },
  { href: "/teams", label: "Equipos", icon: "board", only: "manage" },
  { href: "/leaders", label: "Líderes", icon: "leaders", only: "leaders" },
  { href: "/weekly", label: "Detalle semanal", icon: "week" },
  { href: "/settings", label: "Integraciones", icon: "plug", only: "admin" },
  { href: "/admin", label: "Usuarios", icon: "sliders", only: "admin" },
];

// Orden del menú de escritorio (la barra inferior usa el orden de LINKS).
const DESKTOP_ORDER = ["/", "/prs", "/team", "/teams", "/leaders", "/weekly", "/reports", "/settings", "/admin"];

export type ShellUser = {
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "VIEWER";
  roleLabel: string;
  mustChangePassword: boolean;
  /** Tiene varios equipos (o es admin con equipos): ve la pantalla de líderes. */
  showLeaders: boolean;
};

const visibleLinks = (user: ShellUser) =>
  user.mustChangePassword
    ? []
    : LINKS.filter(
        (l) =>
          !l.only ||
          (l.only === "admin" && user.role === "ADMIN") ||
          (l.only === "manage" && user.role !== "VIEWER") ||
          (l.only === "leaders" && user.showLeaders),
      );

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function Brand() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500 text-white shadow-sm">
        <Icon name="report" className="h-[18px] w-[18px]" />
      </span>
      <span className="font-semibold tracking-tight text-white">Team Tracker</span>
    </div>
  );
}

function SidebarBody({ pathname, user }: { pathname: string; user: ShellUser }) {
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  const links = visibleLinks(user).sort((a, b) => DESKTOP_ORDER.indexOf(a.href) - DESKTOP_ORDER.indexOf(b.href));
  return (
    <>
      <Brand />
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Principal">
        {links.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${
                active ? "bg-white/10 text-white shadow-[inset_3px_0_0_#818cf8]" : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon name={l.icon} className="h-5 w-5 shrink-0" />
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="shrink-0 space-y-1 border-t border-white/10 p-3 pb-safe">
        <Link
          href="/account"
          aria-current={pathname.startsWith("/account") ? "page" : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition ${
            pathname.startsWith("/account") ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
          }`}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-500/30 text-xs font-semibold text-indigo-100">{initial}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium leading-tight">{user.name}</span>
            <span className="block truncate text-xs text-slate-400">{user.roleLabel}</span>
          </span>
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white">
            <Icon name="logout" className="h-5 w-5 shrink-0" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </>
  );
}

const tabBase = "relative flex min-h-14 flex-1 select-none flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition active:bg-slate-100";

function Tab({ active, icon, label, children }: { active: boolean; icon: IconName; label: string; children?: never }) {
  return (
    <>
      <span className={`grid h-7 w-14 place-items-center rounded-full transition ${active ? "bg-indigo-100 text-indigo-700" : "text-slate-500"}`}>
        <Icon name={icon} className="h-[22px] w-[22px]" />
      </span>
      <span className={active ? "text-indigo-700" : "text-slate-500"}>{label}</span>
    </>
  );
}

/**
 * Estructura de toda la app. Escritorio (≥ 1024 px): barra lateral fija. Celular y tablet: barra de pestañas inferior
 * como en una app nativa (las 4 pantallas de uso diario) y una hoja «Más» que sube desde abajo con el resto.
 */
export function AppShell({
  user,
  syncStatus,
  teamSwitcher,
  children,
}: {
  user: ShellUser;
  syncStatus: SyncStatus;
  teamSwitcher: TeamSwitcherProps | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // La hoja se cierra al navegar.
  useEffect(() => setOpen(false), [pathname]);

  // Con la hoja abierta: Esc la cierra, el fondo no se desplaza y al cerrar el foco vuelve al botón.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
      document.addEventListener("keydown", onKey);
      wasOpen.current = true;
      return () => {
        document.body.style.overflow = prev;
        document.removeEventListener("keydown", onKey);
      };
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      moreButton.current?.focus();
    }
  }, [open]);

  const links = visibleLinks(user);
  const tabs = links.filter((l) => l.tab);
  const more = links.filter((l) => !l.tab);
  const moreActive = pathname.startsWith("/account") || more.some((l) => isActive(pathname, l.href));
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="min-h-dvh">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Saltar al contenido
      </a>

      {/* Escritorio */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-slate-900 lg:flex">
        <SidebarBody pathname={pathname} user={user} />
      </aside>

      <div className="lg:pl-60">
        <header data-app-chrome className="pt-safe-top sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex min-h-12 items-center gap-2 px-3 sm:px-6 lg:min-h-14">
            <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="Team Tracker, ir al resumen">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm">
                <Icon name="report" className="h-[18px] w-[18px]" />
              </span>
              <span className="hidden text-sm font-semibold tracking-tight text-slate-900 min-[400px]:inline">Team Tracker</span>
            </Link>
            <div className="ml-auto flex min-w-0 shrink items-center gap-2">
              {teamSwitcher && <TeamSwitcher {...teamSwitcher} />}
              {!user.mustChangePassword && (
                <div className="shrink-0">
                  <SyncBar initial={syncStatus} />
                </div>
              )}
            </div>
          </div>
        </header>
        <main
          id="contenido"
          key={pathname}
          className="mx-auto w-full max-w-6xl animate-[fade-up_.22s_ease-out] space-y-5 px-4 pb-nav pt-4 sm:space-y-6 sm:px-6 sm:pt-8 lg:pb-8"
        >
          {children}
        </main>
      </div>

      {/* Celular y tablet: barra de pestañas inferior */}
      <nav data-app-chrome aria-label="Principal" className="pb-safe-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-xl">
          {user.mustChangePassword ? (
            <>
              <Link href="/account" aria-current="page" className={tabBase}>
                <Tab active icon="user" label="Mi cuenta" />
              </Link>
              <form action={logoutAction} className="flex flex-1">
                <button type="submit" className={`${tabBase} w-full`}>
                  <Tab active={false} icon="logout" label="Salir" />
                </button>
              </form>
            </>
          ) : (
            <>
              {tabs.map((l) => {
                const active = isActive(pathname, l.href);
                return (
                  <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={tabBase}>
                    <Tab active={active} icon={l.icon} label={l.short ?? l.label} />
                  </Link>
                );
              })}
              <button ref={moreButton} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={tabBase}>
                <Tab active={moreActive || open} icon="more" label="Más" />
              </button>
            </>
          )}
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Más opciones">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 animate-[fade-in_.15s_ease-out] bg-slate-950/50" onClick={() => setOpen(false)} />
          <div className="pb-safe absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] max-w-xl animate-[sheet-up_.22s_ease-out] overflow-y-auto rounded-t-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 bg-white pb-1 pt-2">
              <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-200" aria-hidden />
            </div>
            <Link
              href="/account"
              className="mx-3 mt-1 flex min-h-14 items-center gap-3 rounded-xl bg-slate-50 px-3 active:bg-slate-100"
              aria-current={pathname.startsWith("/account") ? "page" : undefined}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-100 font-semibold text-indigo-700">{initial}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{user.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {user.roleLabel} · Mi cuenta
                </span>
              </span>
              <Icon name="right" className="h-4 w-4 shrink-0 text-slate-400" />
            </Link>

            {more.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 px-3 pt-3">
                {more.map((l) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-xs font-medium transition active:scale-95 ${
                          active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-700 active:bg-slate-50"
                        }`}
                      >
                        <Icon name={l.icon} className="h-6 w-6" />
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <form action={logoutAction} className="p-3">
              <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-600 active:bg-slate-100">
                <Icon name="logout" className="h-5 w-5" />
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
