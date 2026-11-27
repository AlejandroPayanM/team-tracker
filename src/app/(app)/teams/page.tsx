import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getScope } from "@/lib/access";
import { Card, PageHeader } from "@/components/ui";
import { NewTeamDialog } from "@/components/admin-forms";
import { TeamBoard, type BoardPerson, type BoardTeam } from "@/components/team-board";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const scope = await getScope();
  if (!scope.canManage) notFound();
  const teamIds = scope.teams.map((t) => t.id);

  const [teams, admins, members, unassigned] = await Promise.all([
    db.team.findMany({
      where: scope.isAdmin ? {} : { id: { in: teamIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, leaderId: true, users: { where: { role: "MANAGER" }, select: { id: true, name: true } } },
    }),
    db.user.findMany({ where: { role: "ADMIN" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // El tablero muestra todo lo que el usuario puede administrar (no depende del selector de la barra superior).
    db.member.findMany({
      where: { archivedAt: null, ...(scope.isAdmin ? {} : { teamId: { in: teamIds } }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, teamId: true },
    }),
    scope.isAdmin ? db.member.count({ where: { archivedAt: null, teamId: null } }) : Promise.resolve(0),
  ]);

  const boardTeams: BoardTeam[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    leaderId: t.leaderId,
    leaderOptions: [...admins, ...t.users].sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const people: BoardPerson[] = members;

  return (
    <>
      <PageHeader
        title="Equipos"
        description={
          scope.isAdmin
            ? "Arrastra a las personas entre equipos, o usa «+ Agregar» y «⇄». Cada cambio se guarda al instante."
            : "Mueve a las personas entre tus equipos arrastrándolas o con «⇄». Cada cambio se guarda al instante."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Link href="/team" className="btn-ghost btn-sm">Ver personas</Link>
            {scope.isAdmin && <NewTeamDialog unassigned={unassigned} />}
          </div>
        }
      />

      {boardTeams.length === 0 ? (
        <Card title="Empecemos">
          <ol className="space-y-4">
            <li><strong>1. Crea tu primer equipo</strong><span className="block text-sm text-slate-500">Por ejemplo «Plataforma» o el nombre de la célula.</span></li>
            <li><strong>2. Pasa a las personas</strong><span className="block text-sm text-slate-500">Arrástralas al equipo o usa «+ Agregar».</span></li>
            <li><strong>3. Da acceso a un líder</strong><span className="block text-sm text-slate-500">En «Usuarios» crea a quien verá ese equipo y aquí lo designas como líder.</span></li>
          </ol>
          {scope.isAdmin && (
            <div className="mt-5">
              <NewTeamDialog unassigned={unassigned} primary />
            </div>
          )}
        </Card>
      ) : (
        <TeamBoard teams={boardTeams} people={people} isAdmin={scope.isAdmin} />
      )}
    </>
  );
}
