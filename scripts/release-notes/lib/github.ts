const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = 'sanity-io/context'

export interface ReleaseInfo {
  version: string
  publishedAt: string
  markdown: string
}

interface GitHubRelease {
  body: string
  published_at: string
}

export interface PullRequest {
  number: number
  title: string
  body: string
}

/**
 * Uses GITHUB_TOKEN when available to avoid rate limits.
 */
function headers(): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'sanity-release-notes',
  }

  if (GITHUB_TOKEN) {
    h['Authorization'] = `Bearer ${GITHUB_TOKEN}`
  }

  return h
}

/**
 * Fetches the GitHub release for a version. Retries on 404 since
 * the release may not exist right after the tag is pushed.
 */
export async function getReleaseInfo(
  version: string,
  {retries = 3, delayMs = 5000}: {retries?: number; delayMs?: number} = {},
): Promise<ReleaseInfo> {
  const tag = `context-v${version}`
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {headers: headers()})

    if (response.ok) {
      const release: GitHubRelease = await response.json()
      return {
        version,
        publishedAt: release.published_at,
        markdown: release.body || '',
      }
    }

    if (response.status === 404 && attempt < retries) {
      console.log(`   Release not found yet, retrying in ${delayMs / 1000}s...`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      continue
    }

    throw new Error(`GitHub release not found: ${tag} (${response.status})`)
  }

  throw new Error(`GitHub release not found after ${retries} retries: ${tag}`)
}

/**
 * Extracts PR numbers from the `[#123](url)` links in release-please markdown.
 */
export function extractPRNumbers(markdown: string): number[] {
  const matches = [...markdown.matchAll(/\[#(\d+)\]/g)]
  return [...new Set(matches.map((m) => parseInt(m[1], 10)))]
}

export async function fetchPullRequests(prNumbers: number[]): Promise<PullRequest[]> {
  const results = await Promise.all(
    prNumbers.map(async (prNumber) => {
      const url = `https://api.github.com/repos/${GITHUB_REPO}/pulls/${prNumber}`
      const response = await fetch(url, {headers: headers()})

      if (!response.ok) {
        console.log(`   Skipping PR #${prNumber} (${response.status})`)
        return null
      }

      const pr: PullRequest = await response.json()

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
      }
    }),
  )

  return results.filter((pr): pr is PullRequest => pr !== null)
}
