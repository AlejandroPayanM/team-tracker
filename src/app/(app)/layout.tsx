import { ROLE_LABEL, requireUser } from "@/lib/auth";
import { getScope } from "@/lib/access";
import { getSyncStatus } from "@/lib/autosync";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Con contraseña temporal solo se puede llegar a «Mi cuenta»: aquí no se redirige (sería un ciclo).
  const user = await requireUser({ allowPasswordChange: true });
  const pending = user.mustChangePassword;
  const [syncStatus, scope] = await Promise.all([getSyncStatus(), pending ? Promise.resolve(null) : getScope()]);
  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role, roleLabel: ROLE_LABEL[user.role], mustChangePassword: pending, showLeaders: !!scope && (scope.isAdmin ? scope.teams.length > 0 : scope.teams.length > 1) }}
      syncStatus={syncStatus}
      teamSwitcher={scope && scope.options.length > 0 && scope.teams.length > 0 ? { options: scope.options, selected: scope.selected } : null}
    >
      {children}
    </AppShell>
  );
}
