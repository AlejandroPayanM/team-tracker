import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/forms";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* Panel de marca: solo en pantallas grandes */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-slate-900 p-12 text-slate-200 lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500 text-white shadow">
            <Icon name="report" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">Team Tracker</span>
        </div>
        <div className="max-w-md space-y-5">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">Seguimiento claro del trabajo de tu equipo.</h2>
          <ul className="space-y-3 text-sm text-slate-300">
            <li className="flex gap-3"><Icon name="pr" className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" />PRs, reviews y tareas por persona, semana y repositorio.</li>
            <li className="flex gap-3"><Icon name="refresh" className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" />Datos que se mantienen al día solos.</li>
            <li className="flex gap-3"><Icon name="download" className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" />Reportes exportables a Excel, PDF e imagen.</li>
          </ul>
        </div>
        <p className="text-xs text-slate-500">Acceso restringido.</p>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Icon name="report" className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Team Tracker</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Inicia sesión</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">Para ver el seguimiento del equipo.</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}
