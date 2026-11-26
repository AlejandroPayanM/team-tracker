import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
import { IntegrationPanel } from "@/components/forms";
import { formatDateTime } from "@/lib/weeks";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // las acciones de sincronización corren en esta ruta

const STATUS_TONE = { OK: "green", WARNING: "amber", ERROR: "red" } as const;
const STATUS_LABEL: Record<string, string> = { OK: "OK", WARNING: "CON AVISOS", ERROR: "ERROR", SKIPPED: "OMITIDA", RUNNING: "EN CURSO" };

export default async function SettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const [runs, logs] = await Promise.all([
    db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
    isAdmin ? db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }) : Promise.resolve([]),
  ]);

  return (
    <>
      <h1 className="text-xl font-semibold">Integraciones</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="GitHub">
          <p className="text-sm">
            {env.githubConfigured ? <Badge tone="green">Token configurado</Badge> : <Badge tone="amber">Falta GITHUB_TOKEN</Badge>}
            {env.githubOrg && <span className="ml-2 text-slate-500">Organización: {env.githubOrg}</span>}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Se usa el usuario de GitHub de cada compañero; si no lo capturas, se intenta descubrir a partir de su correo
            (solo funciona con correos públicos o presentes en commits visibles).
          </p>
        </Card>
        <Card title="Zoho Projects">
          <p className="text-sm">
            {env.zohoConfigured ? <Badge tone="green">Credenciales configuradas</Badge> : <Badge tone="amber">Faltan credenciales ZOHO_*</Badge>}
            <span className="ml-2 text-slate-500">DC: {env.zohoDc}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Se liga a cada compañero por correo con los usuarios del portal y se traen sus tareas asignadas.
          </p>
        </Card>
      </div>

      {isAdmin && (
        <Card title="Sincronización">
          <IntegrationPanel />
          <p className="mt-3 text-xs text-slate-500">
            Para automatizar: programa una llamada a <code>/api/cron/sync</code> con el header{" "}
            <code>Authorization: Bearer $CRON_SECRET</code>, o ejecuta <code>npm run sync</code>.
          </p>
        </Card>
      )}

      <Card title="Últimas sincronizaciones">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              {["Fuente", "Origen", "Estado", "Elementos", "Inicio", "Detalle"].map((h) => (
                <th key={h} className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.source}</td>
                <td className="td">{r.trigger}</td>
                <td className="td">
                  <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "blue"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                </td>
                <td className="td">{r.items}</td>
                <td className="td">{formatDateTime(r.startedAt)}</td>
                <td className="td max-w-xs truncate text-xs text-slate-500" title={r.error ?? ""}>{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {isAdmin && (
        <Card title="Auditoría (últimos 30 eventos)">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {["Fecha", "Usuario", "Acción", "Detalle", "IP"].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="td whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                  <td className="td">{l.userEmail ?? "—"}</td>
                  <td className="td font-mono text-xs">{l.action}</td>
                  <td className="td max-w-xs truncate text-xs text-slate-500" title={l.detail ?? ""}>{l.detail ?? ""}</td>
                  <td className="td text-xs">{l.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
