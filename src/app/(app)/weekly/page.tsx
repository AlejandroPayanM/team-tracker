import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { addWeeks, formatDate, parseWeekParam } from "@/lib/weeks";
import { Badge, Card, Empty, WeekNav, prBadge } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireUser();
  const week = parseWeekParam((await searchParams).week);
  const range = { gte: week, lt: addWeeks(week, 1) };

  const members = await db.member.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      pullRequests: {
        where: { OR: [{ createdAtGh: range }, { mergedAt: range }] },
        orderBy: { createdAtGh: "asc" },
      },
      reviews: { where: { submittedAt: range }, include: { pullRequest: { select: { repo: true, number: true, url: true, title: true } } } },
      zohoTasks: { where: { OR: [{ completedAt: range }, { updatedAtZ: range }] }, orderBy: { updatedAtZ: "desc" } },
    },
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Detalle semanal</h1>
        <WeekNav base="/weekly" week={week} />
      </div>

      {members.length === 0 && (
        <Card>
          <Empty>No hay compañeros activos.</Empty>
        </Card>
      )}

      {members.map((m) => {
        const empty = !m.pullRequests.length && !m.reviews.length && !m.zohoTasks.length;
        return (
          <Card
            key={m.id}
            title={m.name}
            action={
              <span className="text-xs text-slate-500">
                {m.pullRequests.length} PRs · {m.reviews.length} reviews · {m.zohoTasks.length} tareas
              </span>
            }
          >
            {empty ? (
              <p className="text-sm text-amber-700">Sin actividad registrada esta semana.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-3 text-sm">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Pull requests</h3>
                  {m.pullRequests.length === 0 ? (
                    <p className="text-slate-400">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {m.pullRequests.map((p) => (
                        <li key={p.id}>
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline">
                            {p.repo}#{p.number}
                          </a>{" "}
                          {prBadge(p.state, p.isDraft)}
                          <div className="truncate text-xs text-slate-500">{p.title}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Reviews</h3>
                  {m.reviews.length === 0 ? (
                    <p className="text-slate-400">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {m.reviews.map((r) => (
                        <li key={r.id}>
                          <a href={r.pullRequest.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline">
                            {r.pullRequest.repo}#{r.pullRequest.number}
                          </a>{" "}
                          <Badge tone={r.state === "APPROVED" ? "green" : r.state === "CHANGES_REQUESTED" ? "red" : "gray"}>{r.state.toLowerCase().replace("_", " ")}</Badge>
                          <div className="truncate text-xs text-slate-500">{r.pullRequest.title}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Tareas Zoho</h3>
                  {m.zohoTasks.length === 0 ? (
                    <p className="text-slate-400">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {m.zohoTasks.map((t) => (
                        <li key={t.id}>
                          <span className="font-medium">{t.name}</span>{" "}
                          {t.completed ? <Badge tone="green">completada</Badge> : <Badge tone="blue">{t.status}</Badge>}
                          <div className="text-xs text-slate-500">
                            {t.projectName} · act. {formatDate(t.updatedAtZ)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            <Link href={`/team/${m.id}`} className="mt-3 inline-block text-xs text-indigo-600 hover:underline">
              Ver perfil completo →
            </Link>
          </Card>
        );
      })}
    </>
  );
}
