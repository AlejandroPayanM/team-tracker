import { env } from "./env";
import { cleanErrorBody, retryDelays, sleep } from "./http";

const REST = "https://api.github.com";
const TRANSIENT = new Set([502, 503, 504]); // errores pasajeros de GitHub o de su proxy

async function ghFetch(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const token = env.githubToken;
  if (!token) throw new Error("GITHUB_TOKEN no está configurado");
  const delays = retryDelays();
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "team-tracker",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    // Sin respuesta (corte de red, tiempo agotado): se reintenta con espera creciente.
    if (attempt < delays.length) {
      await sleep(delays[attempt]!);
      return ghFetch(url, init, attempt + 1);
    }
    throw new Error(`No se pudo conectar con GitHub: ${e instanceof Error ? e.message : e}`);
  }
  if (TRANSIENT.has(res.status) && attempt < delays.length) {
    await sleep(delays[attempt]!);
    return ghFetch(url, init, attempt + 1);
  }
  if ((res.status === 403 || res.status === 429) && attempt < 3) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const exhausted = res.headers.get("x-ratelimit-remaining") === "0";
    const wait = retryAfter
      ? retryAfter * 1000
      : exhausted && reset
        ? reset * 1000 - Date.now() + 1000
        : 20_000 * (attempt + 1);
    if (wait > 120_000) throw new Error("Límite de peticiones de GitHub alcanzado; reintenta más tarde.");
    await sleep(Math.max(wait, 1000));
    return ghFetch(url, init, attempt + 1);
  }
  return res;
}

export type GhPullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  comments: { totalCount: number };
  reviews: {
    nodes: Array<{
      id: string;
      state: string;
      submittedAt: string | null;
      author: { login: string } | null;
    } | null> | null;
  };
};

const SEARCH_QUERY = /* GraphQL */ `
  query ($q: String!, $cursor: String) {
    search(query: $q, type: ISSUE, first: 25, after: $cursor) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          id number title url state isDraft
          createdAt updatedAt mergedAt closedAt
          additions deletions changedFiles
          author { login }
          repository { nameWithOwner }
          comments { totalCount }
          reviews(first: 50) { nodes { id state submittedAt author { login } } }
        }
      }
    }
  }
`;

type SearchResponse = {
  data?: {
    search: {
      issueCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<GhPullRequest | Record<string, never> | null>;
    };
  };
  errors?: Array<{ message: string }>;
};

/** Itera todos los PRs que cumplen una búsqueda de GitHub (máx. 1000 resultados por búsqueda). */
export async function* searchPullRequests(
  q: string,
): AsyncGenerator<{ pr: GhPullRequest; total: number }> {
  let cursor: string | null = null;
  // Páginas de 25 (menos carga por petición, menos 502); 40 páginas = tope de 1000 resultados de la búsqueda.
  for (let page = 0; page < 40; page++) {
    const res = await ghFetch(`${REST}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { q, cursor } }),
    });
    if (!res.ok) {
      const body = cleanErrorBody(await res.text());
      const hint = res.status >= 500 ? " (error temporal de GitHub; se reintentará en la próxima sincronización)" : "";
      throw new Error(`GitHub GraphQL ${res.status}${body ? `: ${body}` : ""}${hint}`);
    }
    const json = (await res.json()) as SearchResponse;
    if (json.errors?.length) throw new Error(`GitHub: ${json.errors.map((e) => e.message).join("; ")}`);
    const s = json.data!.search;
    for (const n of s.nodes) {
      if (n && "number" in n) yield { pr: n as GhPullRequest, total: s.issueCount };
    }
    if (!s.pageInfo.hasNextPage) return;
    cursor = s.pageInfo.endCursor;
  }
}

/**
 * Intenta descubrir el usuario de GitHub a partir de un correo.
 * Limitación: GitHub solo expone correos públicos o los usados en commits visibles
 * para el token. Si no se encuentra, hay que capturarlo manualmente.
 */
export async function resolveGithubLogin(email: string): Promise<string | null> {
  const users = await ghFetch(`${REST}/search/users?q=${encodeURIComponent(`${email} in:email`)}&per_page=2`);
  if (users.ok) {
    const j = (await users.json()) as { total_count: number; items: Array<{ login: string }> };
    if (j.total_count === 1 && j.items[0]) return j.items[0].login.toLowerCase();
  }
  const org = env.githubOrg ? ` org:${env.githubOrg}` : "";
  const commits = await ghFetch(`${REST}/search/commits?q=${encodeURIComponent(`author-email:${email}${org}`)}&per_page=1`);
  if (commits.ok) {
    const j = (await commits.json()) as { items: Array<{ author: { login: string } | null }> };
    const login = j.items[0]?.author?.login;
    if (login) return login.toLowerCase();
  }
  return null;
}

export async function checkGithub(): Promise<{ ok: true; login: string } | { ok: false; error: string }> {
  try {
    const res = await ghFetch(`${REST}/user`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: token inválido o sin permisos` };
    const j = (await res.json()) as { login: string };
    return { ok: true, login: j.login };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
