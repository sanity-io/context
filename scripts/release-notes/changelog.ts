/**
 * Creates changelog entries on sanity.io/changelog for @sanity/context releases.
 *
 * Flow:
 *  1. Fetch the GitHub release created by release-please
 *  2. Fetch PR descriptions from the referenced PRs
 *  3. Send to Claude to generate a title + body
 *  4. Write apiVersion + apiChange docs into a Content Release in Sanity
 *  5. Review and publish in Studio
 */

import {appendFileSync} from 'node:fs'

import {markdownToPortableText} from '@portabletext/markdown'
import {ClientError} from '@sanity/client'
import chalk from 'chalk'

import {generateContent} from './lib/content'
import {extractPRNumbers, fetchPullRequests, getReleaseInfo} from './lib/github'
import {AGENT_CONTEXT_PLATFORM_ID, createDocumentIds, getClient} from './lib/sanity'

export async function createChangelogDocuments(
  version: string,
  {dryRun = false}: {dryRun?: boolean} = {},
): Promise<void> {
  console.log(
    chalk.bold(
      dryRun
        ? `📋 Preview for version ${chalk.cyan(version)}`
        : `📝 Creating changelog for version ${chalk.cyan(version)}`,
    ),
  )

  console.log(chalk.dim(`1. Fetching GitHub release...`))
  const releaseInfo = await getReleaseInfo(version)
  console.log(chalk.gray(`   Found release for v${releaseInfo.version}`))

  console.log(chalk.dim(`2. Fetching PR details...`))
  const prNumbers = extractPRNumbers(releaseInfo.markdown)
  const prs = await fetchPullRequests(prNumbers)
  console.log(chalk.gray(`   ${prs.length} PR(s) fetched`))

  console.log(chalk.dim(`3. Generating content...`))
  const {title, body} = await generateContent(releaseInfo.markdown, prs)
  console.log(chalk.gray(`   Title: ${title}`))

  if (dryRun) {
    console.log(chalk.dim(`Generated body:`))
    console.log(chalk.gray(body))
    console.log(chalk.green('✅ Preview complete.'))
    return
  }

  const client = getClient()
  const {releaseId, changelogDocumentId, apiVersionDocId} = createDocumentIds(version)
  const suggestedContent = markdownToPortableText(body)

  console.log(chalk.dim(`4. Creating release ${releaseId}...`))
  const releaseTitle = `@sanity/context v${version}`
  const releaseDescription = `Changelog for @sanity/context v${version}`

  await client.releases.create({releaseId}).catch((err: unknown) => {
    if (
      err instanceof ClientError &&
      err.statusCode === 409 &&
      err.response?.body?.error?.type === 'documentAlreadyExistsError'
    ) {
      return
    }
    throw err
  })

  await client.releases.edit({
    releaseId,
    patch: {
      set: {
        'metadata.title': releaseTitle,
        'metadata.description': releaseDescription,
      },
    },
  })

  console.log(chalk.dim(`5. Creating documents...`))
  const transaction = client.transaction()

  transaction.createIfNotExists({
    _id: AGENT_CONTEXT_PLATFORM_ID,
    _type: 'apiPlatform',
    title: 'Sanity Context',
    npmName: '@sanity/context',
  })

  transaction.createOrReplace({
    _id: apiVersionDocId.version,
    _type: 'apiVersion',
    semver: version,
    date: releaseInfo.publishedAt.split('T')[0],
    platform: {_ref: AGENT_CONTEXT_PLATFORM_ID, _type: 'reference'},
  })

  transaction.createOrReplace({
    _id: changelogDocumentId.version,
    _type: 'apiChange',
    title,
    publishedAt: releaseInfo.publishedAt,
    version: {_ref: apiVersionDocId.published, _type: 'reference'},
    releaseAutomation: {
      tentativeVersion: version,
      source: 'context',
      suggestedContent,
    },
  })

  await transaction.commit()

  console.log(chalk.green('✅ Changelog release created!'))
  console.log(chalk.dim(`Release: ${releaseId}`))

  const studioBaseUrl = process.env.CHANGELOG_STUDIO_BASE_URL
  if (studioBaseUrl) {
    const studioUrl = `${studioBaseUrl}/releases/${releaseId}?perspective=${releaseId}`
    console.log(chalk.cyan(`Review in Studio: ${studioUrl}`))

    // Expose the URL as a step output so the workflow can use it (e.g. in Slack)
    const ghOutput = process.env.GITHUB_OUTPUT
    if (ghOutput) {
      appendFileSync(ghOutput, `studio_url=${studioUrl}\n`)
    }
  } else {
    console.log(chalk.dim(`Review and publish in Studio when ready.`))
  }
}

export async function deleteChangelogDocuments(version: string): Promise<void> {
  console.log(chalk.bold(`🗑️  Deleting changelog for version ${chalk.cyan(version)}`))

  const client = getClient()
  const {releaseId, changelogDocumentId, apiVersionDocId} = createDocumentIds(version)

  console.log(chalk.dim(`1. Deleting documents...`))
  await client.delete({
    query: `*[_id in $ids]`,
    params: {ids: [changelogDocumentId.version, apiVersionDocId.version]},
  })

  console.log(chalk.dim(`2. Deleting release ${releaseId}...`))
  try {
    await client.releases.delete({releaseId})
  } catch {
    console.log(chalk.gray('Release not found or already deleted'))
  }

  console.log(chalk.green('✅ Deletion complete.'))
}
