"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/actions";
import { Icon, type IconName } from "@/components/icons";
import { SyncBar, type SyncStatus } from "@/components/sync-bar";
import { TeamSwitcher, type TeamSwitcherProps } from "@/components/team-switcher";

type NavLink = { href: string; label: string; icon: IconName; only?: "admin" | "manage" | "leaders" };

const LINKS: NavLink[] = [
  { href: "/", label: "Resumen", icon: "dashboard" },
  { href: "/prs", label: "Pull requests", icon: "pr" },
  { href: "/team", label: "Personas", icon: "team" },
  { href: "/teams", label: "Equipos", icon: "board", only: "manage" },
  { href: "/leaders", label: "Líderes", icon: "leaders", only: "leaders" },
  { href: "/weekly", label: "Detalle semanal", icon: "week" },
  { href: "/reports", label: "Reportes", icon: "report" },
  { href: "/settings", label: "Integraciones", icon: "plug", only: "admin" },
  { href: "/admin", label: "Usuarios", icon: "sliders", only: "admin" },
];

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

function Brand({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500 text-white shadow-sm">
        <Icon name="report" className="h-[18px] w-[18px]" />
      </span>
      <span className="font-semibold tracking-tight text-white">Team Tracker</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Cerrar menú" className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white">
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

function SidebarBody({ pathname, user, onClose }: { pathname: string; user: ShellUser; onClose?: () => void }) {
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <>
      <Brand onClose={onClose} />
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Principal">
        {visibleLinks(user).map((l) => {
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

/**
 * Estructura de toda la app: barra lateral fija en escritorio (≥ 1024 px) y cajón deslizable en celular y tablet.
 * La barra superior queda fija y lleva el estado de sincronización.
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // El cajón se cierra al navegar.
  useEffect(() => setOpen(false), [pathname]);

  // Con el cajón abierto: Esc lo cierra, el fondo no se desplaza y al cerrar el foco vuelve al botón.
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
      menuButton.current?.focus();
    }
  }, [open]);

  const current = visibleLinks(user).find((l) => isActive(pathname, l.href))?.label ?? (pathname.startsWith("/account") ? "Mi cuenta" : "Team Tracker");

  return (
    <div className="min-h-screen">
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

      {/* Celular y tablet */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú de navegación">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-72 animate-[slide-in_.18s_ease-out] flex-col bg-slate-900 shadow-2xl">
            <SidebarBody pathname={pathname} user={user} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <header data-app-chrome className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-6">
          <button
            ref={menuButton}
            type="button"
            className="btn-ghost !px-2.5 lg:hidden"
            aria-label="Abrir menú"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <span className="truncate text-sm font-semibold text-slate-800 lg:hidden">{current}</span>
          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
            {teamSwitcher && <TeamSwitcher {...teamSwitcher} />}
            {!user.mustChangePassword && (
              <div className="shrink-0">
                <SyncBar initial={syncStatus} />
              </div>
            )}
          </div>
        </header>
        <main id="contenido" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
