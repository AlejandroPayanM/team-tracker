import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { requireUser } from "@/lib/auth";
import { settingsOverview, type SettingKey, type SettingView } from "@/lib/settings";
import { Badge, Card } from "@/components/ui";
import { IntegrationPanel } from "@/components/forms";
import { GithubCredentialsForm, IntegrationCard, ZohoCredentialsForm, type FieldInfo } from "@/components/credentials-forms";
import { formatDateTime } from "@/lib/weeks";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // las acciones de sincronización corren en esta ruta

const STATUS_TONE = { OK: "green", WARNING: "amber", ERROR: "red" } as const;
const STATUS_LABEL: Record<string, string> = { OK: "OK", WARNING: "CON AVISOS", ERROR: "ERROR", SKIPPED: "OMITIDA", RUNNING: "EN CURSO" };

export default async function SettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const [runs, logs, cfg, overview] = await Promise.all([
    // Las corridas automáticas sin cambios no se listan (ocurren cada pocos minutos y taparían lo importante).
    db.syncRun.findMany({
      where: { NOT: { trigger: "auto", status: "OK", items: 0 } },
      orderBy: { startedAt: "desc" },
      take: 15,
    }),
    isAdmin ? db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }) : Promise.resolve([]),
    getConfig(),
    isAdmin ? settingsOverview() : Promise.resolve(null),
  ]);

  // Para los formularios: nunca viajan secretos completos al navegador, solo su versión enmascarada.
  const info = (key: SettingKey): FieldInfo => {
    const v: SettingView = overview!.items[key];
    return {
      source: v.source,
      display: v.display,
      secret: v.secret,
      meta: v.updatedAt ? `${formatDateTime(v.updatedAt)}${v.updatedBy ? ` · ${v.updatedBy}` : ""}` : null,
    };
  };

  const keyNotice = (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <strong>Falta una llave de cifrado para guardar secretos aquí.</strong> Define la variable <code>APP_ENCRYPTION_KEY</code> (≥ 32
      caracteres aleatorios) en Vercel y redespliega, una sola vez. Genera una con:{" "}
      <code className="break-all">node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;</code>.
      Mientras tanto puedes seguir usando las variables de entorno.
    </div>
  );
  const secretsNote = (
    <p className="text-xs text-slate-500">
      Los secretos se guardan cifrados (AES-256-GCM) y nunca se muestran completos. Lo guardado aquí tiene prioridad sobre las variables de
      entorno. Cada cambio queda en la auditoría, solo con el nombre del ajuste.
    </p>
  );

  return (
    <>
      <h1 className="text-xl font-semibold">Integraciones</h1>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <IntegrationCard
          title="GitHub"
          canConfigure={isAdmin && !!overview}
          summary={
            <>
              <p className="text-sm">
                {cfg.githubConfigured ? <Badge tone="green">Token configurado</Badge> : <Badge tone="amber">Falta el token</Badge>}
                {cfg.github.org && <span className="ml-2 text-slate-500">Organización: {cfg.github.org}</span>}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Se usa el usuario de GitHub de cada compañero; si no lo capturas, se intenta descubrir a partir de su correo
                (solo funciona con correos públicos o presentes en commits visibles).
              </p>
            </>
          }
        >
          {overview && (
            <>
              {!overview.encryptionReady && keyNotice}
              <GithubCredentialsForm token={info("github.token")} org={info("github.org")} encryptionReady={overview.encryptionReady} />
              {secretsNote}
            </>
          )}
        </IntegrationCard>
        <IntegrationCard
          title="Zoho Projects"
          canConfigure={isAdmin && !!overview}
          summary={
            <>
              <p className="text-sm">
                {cfg.zohoConfigured ? <Badge tone="green">Credenciales configuradas</Badge> : <Badge tone="amber">Faltan credenciales</Badge>}
                <span className="ml-2 text-slate-500">DC: {cfg.zoho.dc}</span>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Se liga a cada compañero por correo con los usuarios del portal y se traen sus tareas asignadas.
              </p>
            </>
          }
        >
          {overview && (
            <>
              {!overview.encryptionReady && keyNotice}
              <ZohoCredentialsForm
                encryptionReady={overview.encryptionReady}
                fields={{
                  dc: info("zoho.dc"),
                  clientId: info("zoho.clientId"),
                  clientSecret: info("zoho.clientSecret"),
                  refreshToken: info("zoho.refreshToken"),
                  portalId: info("zoho.portalId"),
                  portalName: info("zoho.portalName"),
                }}
              />
              {secretsNote}
            </>
          )}
        </IntegrationCard>
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
              {["Fuente", "Origen", "Estado", "Nuevos o cambiados", "Inicio", "Duración", "Detalle"].map((h) => (
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
                <td className="td whitespace-nowrap">
                  {r.finishedAt ? `${((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)} s` : "—"}
                </td>
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
