import { db } from "./db";

const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/** Lee ?repo=owner/nombre. Vacío o con formato inválido = sin filtro (todos los repositorios). */
export function parseRepo(raw?: string | null): string | undefined {
  const v = raw?.trim();
  return v && REPO_RE.test(v) ? v : undefined;
}

/** Repositorios donde las personas indicadas han creado PRs o hecho reviews, en orden alfabético. */
export async function listRepos(memberIds: string[]): Promise<string[]> {
  if (!memberIds.length) return [];
  const rows = await db.pullRequest.findMany({
    where: { OR: [{ memberId: { in: memberIds } }, { reviews: { some: { memberId: { in: memberIds } } } }] },
    distinct: ["repo"],
    select: { repo: true },
    orderBy: { repo: "asc" },
  });
  return rows.map((r) => r.repo);
}
