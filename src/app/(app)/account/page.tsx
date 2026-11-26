import { requireUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { PasswordForm } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <h1 className="text-xl font-semibold">Mi cuenta</h1>
      <p className="text-sm text-slate-500">
        {user.name} · {user.email} · {user.role === "ADMIN" ? "Administrador" : "Solo lectura"}
      </p>
      <Card title="Cambiar contraseña">
        <PasswordForm />
        <p className="mt-3 text-xs text-slate-500">
          Mínimo 12 caracteres. Al cambiarla se cierran tus sesiones en otros dispositivos.
        </p>
      </Card>
    </>
  );
}
