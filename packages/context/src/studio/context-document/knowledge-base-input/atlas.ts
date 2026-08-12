/**
 * Atlas (Sanity Context) knowledge-base API helpers, for the Studio picker.
 *
 * The knowledge-base endpoints are org-scoped and live on the same host as the
 * data API (`{apiHost}/vX/context/...`). Studio only knows the projectId, so we
 * first resolve the organizationId from the projects API, then list the org's
 * knowledge bases.
 *
 * These take a minimal client surface so they can be unit-tested without a real
 * Sanity client.
 */

/** A knowledge base as returned by the Atlas list endpoint. */
export interface KnowledgeBase {
  id: string
  slug: string
  name: string
  description?: string
  /** 'ready' knowledge bases are usable; others are still building/created. */
  state?: string
}

/** Options passed through to the underlying client request. */
export interface RequestOptions {
  url: string
  method?: string
  /** Cap retries so a hard failure (e.g. CORS) doesn't loop. */
  maxRetries?: number
  retryDelay?: (attemptNumber: number) => number
}

/** Minimal client surface: a `request` that hits an absolute API path. */
export interface RequestClient {
  request<T>(options: RequestOptions): Promise<T>
}

/**
 * Bounded retry policy shared by the knowledge-base requests: at most 2 retries
 * with a short exponential backoff (300ms, 600ms), capped. Prevents the client's
 * default retry behavior from hammering an endpoint that's hard-failing.
 */
export const KB_RETRY = {
  maxRetries: 2,
  retryDelay: (attemptNumber: number) => Math.min(300 * 2 ** attemptNumber, 2000),
}

/**
 * Resolve the organizationId that owns a project. Mirrors context-mcp's
 * `fetchProjectOrganizationId`. Returns null when the project has no org.
 */
export async function fetchProjectOrganizationId(
  client: RequestClient,
  projectId: string,
): Promise<string | null> {
  const project = await client.request<{organizationId?: string | null}>({
    url: `/projects/${projectId}`,
    ...KB_RETRY,
  })
  return project?.organizationId ?? null
}

/**
 * List the knowledge bases for an organization. The endpoint is cursor-paginated;
 * we follow `nextCursor` so all knowledge bases are returned.
 */
export async function fetchKnowledgeBases(
  client: RequestClient,
  organizationId: string,
): Promise<KnowledgeBase[]> {
  // Version-less path — the configured client prepends the API version (`/vX`)
  // and the bare host (no project hostname), giving
  // `https://api.sanity.work/vX/context/organizations/{org}/knowledge-bases`.
  const base = `/context/organizations/${organizationId}/knowledge-bases`
  const all: KnowledgeBase[] = []
  let cursor: string | undefined

  // Bound the loop defensively; real orgs have far fewer pages.
  for (let page = 0; page < 50; page++) {
    const url = cursor ? `${base}?nextCursor=${encodeURIComponent(cursor)}` : base
    const res = await client.request<{data?: KnowledgeBase[]; nextCursor?: string | null}>({
      url,
      ...KB_RETRY,
    })
    if (res?.data?.length) all.push(...res.data)
    cursor = res?.nextCursor ?? undefined
    if (!cursor) break
  }

  return all
}

/** Resolve the org from the project, then list its knowledge bases. */
export async function fetchKnowledgeBasesForProject(
  client: RequestClient,
  projectId: string,
): Promise<KnowledgeBase[]> {
  const organizationId = await fetchProjectOrganizationId(client, projectId)
  if (!organizationId) return []
  return fetchKnowledgeBases(client, organizationId)
}
