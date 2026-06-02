import Anthropic from '@anthropic-ai/sdk'

import type {PullRequest} from './github'

/**
 * Builds the context string for the AI prompt: changelog from release-please
 * plus PR bodies (capped at 2k chars each).
 */
function buildAIContext(releaseMarkdown: string, prs: PullRequest[]): string {
  const sections: string[] = []

  sections.push('# Release changelog (from conventional commits)\n')
  sections.push(releaseMarkdown)

  if (prs.length > 0) {
    sections.push('\n# PR descriptions\n')
    for (const pr of prs) {
      const body = pr.body.length > 2000 ? pr.body.slice(0, 2000) + '\n…(truncated)' : pr.body
      sections.push(`## PR #${pr.number}: ${pr.title}\n${body}\n`)
    }
  }

  return sections.join('\n')
}

function fallbackContent(releaseMarkdown: string): {title: string; body: string} {
  const firstLine = releaseMarkdown.split('\n').find((l) => l.trim().length > 0) || ''
  const title = firstLine.replace(/^#+\s*/, '').trim() || 'Release update'
  return {title, body: releaseMarkdown}
}

/**
 * Sends the release context to Claude and parses a title + markdown body.
 */
export async function generateContent(
  releaseMarkdown: string,
  prs: PullRequest[],
): Promise<{title: string; body: string}> {
  const apiKey = process.env.CHANGELOG_ANTHROPIC_API_KEY

  if (!apiKey) {
    console.log('   CHANGELOG_ANTHROPIC_API_KEY not set, using raw release markdown')
    return fallbackContent(releaseMarkdown)
  }

  const context = buildAIContext(releaseMarkdown, prs)
  const anthropic = new Anthropic({apiKey})

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are writing a changelog entry for sanity.io/changelog about the @sanity/context package. The audience is developers using this package in their Sanity Studio.

Write a title and body based on the release information below.

**Title**: A short headline (5-15 words) capturing the main user-facing changes. No version numbers.

**Body**: Structured markdown with these rules:
- Start with a 1-2 sentence summary.
- For features/highlights, use a ## heading per change with a short description (1-3 sentences).
- For bug fixes, group under "## Bug fixes" as a bullet list.
- Write for the reader — tell them how it helps, not what changed internally:
  ❌ "Fix render performance issue"
  ✅ "Lists now render 80% faster for studios with many document types"
- New API, hook, or utility? Include a code snippet.
- All headings start at H2 (##).
- Only include user-facing changes. Skip internal refactors, CI, tests, linting, dependency updates, and chores.
- If a release is purely internal, write a single sentence saying so.

Respond in this exact format:
TITLE: <title>
BODY:
<markdown body>

---

${context}`,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock) throw new Error('No text in AI response')

    const text = textBlock.text
    const titleMatch = text.match(/TITLE:\s*(.+)/i)
    const bodyMatch = text.match(/BODY:\s*\n([\s\S]+)/i)

    if (titleMatch && bodyMatch) {
      return {
        title: titleMatch[1].trim(),
        body: bodyMatch[1].trim(),
      }
    }

    throw new Error('Could not parse AI response format')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    console.log(`AI generation failed (${message}), using fallback`)
    return fallbackContent(releaseMarkdown)
  }
}
