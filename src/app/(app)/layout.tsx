import { requireUser } from "@/lib/auth";
import { getSyncStatus } from "@/lib/autosync";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const syncStatus = await getSyncStatus();
  return (
    <AppShell user={{ name: user.name, email: user.email, role: user.role }} syncStatus={syncStatus}>
      {children}
    </AppShell>
  );
}
