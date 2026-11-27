import { ROLE_LABEL, requireUser } from "@/lib/auth";
import { Card, Notice, PageHeader } from "@/components/ui";
import { PasswordForm } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser({ allowPasswordChange: true });
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <>
      <PageHeader title="Mi cuenta" description="Tus datos de acceso y la seguridad de tu cuenta." />
      {user.mustChangePassword && (
        <Notice tone="amber">
          Tu contraseña es temporal. <strong>Cámbiala para continuar</strong>: hasta entonces no podrás ver el resto de la aplicación.
        </Notice>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Perfil">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-indigo-100 text-xl font-semibold text-indigo-700">{initial}</span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{user.name}</p>
              <p className="break-all text-sm text-slate-500">{user.email}</p>
              <p className="mt-1 text-xs font-medium text-slate-600">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
        </Card>
        <Card title="Cambiar contraseña">
          <PasswordForm />
          <p className="mt-3 text-xs text-slate-500">
            Mínimo 12 caracteres. Al cambiarla se cierran tus sesiones en otros dispositivos.
          </p>
        </Card>
      </div>
    </>
  );
}
