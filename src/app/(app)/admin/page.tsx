import Link from "next/link";
import { db } from "@/lib/db";
import { ROLE_LABEL, parseRole, requireAdminPage } from "@/lib/auth";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { EditUserDialog, NewUserDialog } from "@/components/admin-forms";
import { formatDate } from "@/lib/weeks";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireAdminPage();
  const [teams, users] = await Promise.all([
    db.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      include: { teams: { select: { id: true, name: true }, orderBy: { name: "asc" } }, ledTeams: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Usuarios"
        description={
          <>
            Quién entra a la app y qué equipos ve. Los equipos y sus líderes se arman en{" "}
            <Link href="/teams" className="font-medium text-indigo-600 hover:underline">Equipos</Link>.
          </>
        }
        actions={<NewUserDialog teams={teams} />}
      />

      <Card>
        {users.length === 0 ? (
          <Empty>Aún no hay usuarios.</Empty>
        ) : (
          <ul className="-my-1 divide-y divide-slate-100">
            {users.map((u) => {
              const role = parseRole(u.role);
              const self = u.id === me.id;
              return (
                <li key={u.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-100 font-semibold text-indigo-700" aria-hidden>
                    {u.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words font-medium">{u.name}</span>
                      {self && <span className="text-xs text-slate-400">(tú)</span>}
                      <Badge tone={role === "ADMIN" ? "purple" : role === "MANAGER" ? "blue" : "gray"}>{ROLE_LABEL[role]}</Badge>
                      {u.mustChangePassword && <Badge tone="amber">aún no entra</Badge>}
                    </div>
                    <p className="break-all text-xs text-slate-500">{u.email} · alta {formatDate(u.createdAt)}</p>
                    <p className="text-xs text-slate-600">
                      {role === "ADMIN" ? (
                        "Ve todos los equipos"
                      ) : u.teams.length ? (
                        <>
                          <span className="font-medium">Ve:</span> {u.teams.map((t) => t.name).join(", ")}
                        </>
                      ) : (
                        <span className="text-amber-700">Sin equipos asignados: no verá nada. Pulsa «Editar» para darle acceso.</span>
                      )}
                      {u.ledTeams.length > 0 && (
                        <>
                          {" · "}
                          <span className="font-medium">Líder de:</span> {u.ledTeams.map((t) => t.name).join(", ")}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <EditUserDialog id={u.id} name={u.name} email={u.email} role={role} teamIds={u.teams.map((t) => t.id)} teams={teams} self={self} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
