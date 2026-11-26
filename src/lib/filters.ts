import { db } from "./db";

const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/** Lee ?repo=owner/nombre. Vacío o con formato inválido = sin filtro (todos los repositorios). */
export function parseRepo(raw?: string | null): string | undefined {
  const v = raw?.trim();
  return v && REPO_RE.test(v) ? v : undefined;
}

/** Repositorios donde el equipo ha creado PRs o hecho reviews, en orden alfabético. */
export async function listRepos(): Promise<string[]> {
  const rows = await db.pullRequest.findMany({
    where: { OR: [{ memberId: { not: null } }, { reviews: { some: { memberId: { not: null } } } }] },
    distinct: ["repo"],
    select: { repo: true },
    orderBy: { repo: "asc" },
  });
  return rows.map((r) => r.repo);
}
