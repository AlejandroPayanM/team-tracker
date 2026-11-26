import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions";

const links = [
  { href: "/", label: "Resumen" },
  { href: "/team", label: "Equipo" },
  { href: "/weekly", label: "Detalle semanal" },
  { href: "/settings", label: "Integraciones" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">Team Tracker</span>
          <nav className="flex gap-4 text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-slate-600 hover:text-slate-900">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <Link href="/account" className="hover:text-slate-900" title="Mi cuenta">
              {user.name} · {user.role === "ADMIN" ? "Admin" : "Solo lectura"}
            </Link>
            <form action={logoutAction}>
              <button className="btn-ghost" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </>
  );
}
