import Link from "next/link";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { requireUser } from "@/lib/auth";
import { Badge, Card, Empty } from "@/components/ui";
import { MemberForm } from "@/components/forms";
import { restoreMemberAction } from "@/app/actions";
import { formatDate } from "@/lib/weeks";
import { SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // las acciones de sincronización corren en esta ruta

export default async function TeamPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const cfg = await getConfig();
  const [active, archived] = await Promise.all([
    db.member.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    db.member.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" } }),
  ]);

  return (
    <>
      <h1 className="text-xl font-semibold">Equipo</h1>

      {isAdmin && (
        <Card title="Agregar compañero">
          <MemberForm />
          <p className="mt-3 text-xs text-slate-500">
            Al agregarlo se trae su historial de GitHub y Zoho en segundo plano (el periodo depende de SYNC_LOOKBACK_DAYS).
          </p>
        </Card>
      )}

      <Card title={`Activos (${active.length})`}>
        {active.length === 0 ? (
          <Empty>No hay compañeros activos.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {["Nombre", "Correo", "GitHub", "Zoho", "Puesto", "Desde"].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {active.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="td font-medium">
                    <Link className="text-indigo-700 hover:underline" href={`/team/${m.id}`}>{m.name}</Link>
                  </td>
                  <td className="td">{m.email}</td>
                  <td className="td">
                    {m.githubLogin ?? <Badge tone="amber">sin vincular</Badge>}
                    {m.githubLogin && cfg.githubConfigured && !m.githubSyncedAt && (
                      <div className="mt-0.5"><Badge tone="blue">historial pendiente</Badge></div>
                    )}
                  </td>
                  <td className="td">
                    {m.zohoUserId ? <Badge tone="green">vinculado</Badge> : <Badge tone="gray">pendiente</Badge>}
                    {cfg.zohoConfigured && !m.zohoSyncedAt && (
                      <div className="mt-0.5"><Badge tone="blue">historial pendiente</Badge></div>
                    )}
                  </td>
                  <td className="td">{m.position ?? "—"}</td>
                  <td className="td">{formatDate(m.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {archived.length > 0 && (
        <Card title={`Archivados (${archived.length})`}>
          <ul className="divide-y divide-slate-100">
            {archived.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <Link className="font-medium text-indigo-700 hover:underline" href={`/team/${m.id}`}>{m.name}</Link>{" "}
                  <span className="text-slate-500">· archivado {formatDate(m.archivedAt)}</span>
                </span>
                {isAdmin && (
                  <form action={restoreMemberAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <SubmitButton className="btn-ghost">Restaurar</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
