import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-semibold">Team Tracker</h1>
      <p className="mb-6 text-sm text-slate-500">Inicia sesión para ver el seguimiento del equipo.</p>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <LoginForm />
      </div>
    </main>
  );
}
