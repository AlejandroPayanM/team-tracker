import Link from "next/link";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { getScope } from "@/lib/access";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ListFilter } from "@/components/list-filter";
import { MemberForm, SubmitButton } from "@/components/forms";
import { restoreMemberAction } from "@/app/actions";
import { formatDate } from "@/lib/weeks";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // las acciones de sincronización corren en esta ruta

export default async function TeamPage() {
  const scope = await getScope();
  const canEdit = scope.canManage;
  const cfg = await getConfig();
  const [active, archived] = await Promise.all([
    db.member.findMany({ where: { AND: [scope.where, { archivedAt: null }] }, orderBy: { name: "asc" }, include: { team: { select: { name: true } } } }),
    db.member.findMany({ where: { AND: [scope.where, { archivedAt: { not: null } }] }, orderBy: { archivedAt: "desc" }, include: { team: { select: { name: true } } } }),
  ]);
  const showTeam = scope.teams.length > 0;
  // Equipo sugerido al agregar: el que se está viendo; un líder siempre debe elegir uno de los suyos.
  const defaultTeamId = scope.teams.some((t) => t.id === scope.selected) ? scope.selected : scope.isAdmin ? "" : (scope.teams[0]?.id ?? "");

  return (
    <>
      <PageHeader title="Equipo" description={`Personas a las que das seguimiento${showTeam ? ` · ${scope.label}` : ""}. Quitar a alguien lo archiva y conserva su historial.`} />

      {canEdit && (scope.isAdmin || scope.teams.length > 0) && (
        <details className="group rounded-xl border border-slate-200 bg-white shadow-xs" open={active.length === 0 || undefined}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-slate-800 sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
              <Icon name="team" className="h-4 w-4" />
            </span>
            Agregar compañero
            <Icon name="chevron" className="ml-auto h-4 w-4 text-slate-400 transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-slate-100 p-4 sm:p-5">
            <MemberForm teams={scope.teams} defaultTeamId={defaultTeamId} allowNoTeam={scope.isAdmin} />
            <p className="mt-3 text-xs text-slate-500">
              Al agregarlo se trae su historial de GitHub y Zoho en segundo plano (el periodo depende de SYNC_LOOKBACK_DAYS).
            </p>
          </div>
        </details>
      )}

      <ListFilter placeholder="Buscar persona por nombre, correo, GitHub o equipo…" noun="personas">
      <div data-search-group="">
      <Card title={`Activos (${active.length})`}>
        {active.length === 0 ? (
          <Empty>No hay compañeros activos.</Empty>
        ) : (
          <div className="scroll-x -mx-4 sm:-mx-5">
            <table className="rtable w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {["Nombre", ...(showTeam ? ["Equipo"] : []), "Correo", "GitHub", "Zoho", "Puesto", "Desde"].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 max-sm:mx-4 max-sm:block">
                {active.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50" data-search={[m.name, m.email, m.githubLogin, m.position, m.team?.name].filter(Boolean).join(" ")}>
                    <td className="td font-medium" data-primary>
                      <Link className="text-indigo-700 hover:underline" href={`/team/${m.id}`}>{m.name}</Link>
                    </td>
                    {showTeam && (
                      <td className="td" data-label="Equipo">{m.team?.name ?? <span className="text-slate-400">Sin equipo</span>}</td>
                    )}
                    <td className="td break-all" data-label="Correo" data-wide>{m.email}</td>
                    <td className="td" data-label="GitHub">
                      <span className="inline-flex flex-col items-end gap-0.5 sm:items-start">
                        {m.githubLogin ?? <Badge tone="amber">sin vincular</Badge>}
                        {m.githubLogin && cfg.githubConfigured && !m.githubSyncedAt && <Badge tone="blue">historial pendiente</Badge>}
                      </span>
                    </td>
                    <td className="td" data-label="Zoho">
                      <span className="inline-flex flex-col items-end gap-0.5 sm:items-start">
                        {m.zohoUserId ? <Badge tone="green">vinculado</Badge> : <Badge tone="gray">pendiente</Badge>}
                        {cfg.zohoConfigured && !m.zohoSyncedAt && <Badge tone="blue">historial pendiente</Badge>}
                      </span>
                    </td>
                    <td className="td" data-label="Puesto">{m.position ?? "—"}</td>
                    <td className="td whitespace-nowrap" data-label="Desde">{formatDate(m.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>

      {archived.length > 0 && (
        <div data-search-group="">
        <Card title={`Archivados (${archived.length})`}>
          <ul className="divide-y divide-slate-100">
            {archived.map((m) => (
              <li key={m.id} data-search={[m.name, m.email, m.githubLogin, m.team?.name].filter(Boolean).join(" ")} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm">
                <span className="min-w-0">
                  <Link className="font-medium text-indigo-700 hover:underline" href={`/team/${m.id}`}>{m.name}</Link>
                  <span className="block text-xs text-slate-500 sm:ml-2 sm:inline">
                    {showTeam && `${m.team?.name ?? "Sin equipo"} · `}archivado {formatDate(m.archivedAt)}
                  </span>
                </span>
                {canEdit && (
                  <form action={restoreMemberAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <SubmitButton className="btn-ghost btn-sm">Restaurar</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
        </div>
      )}
      </ListFilter>
    </>
  );
}
