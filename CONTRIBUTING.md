# Development

```bash
pnpm install       # Install dependencies
pnpm build         # Build all packages
pnpm dev           # Run development mode
pnpm test:unit     # Run tests
pnpm check:types   # Type check
pnpm check:lint    # Lint
```

# Releases

This repo uses [Release Please](https://github.com/googleapis/release-please) with [Conventional Commits](https://www.conventionalcommits.org/).

## Release flow

1. **Merge your PR to `main`** — use conventional commit prefixes:
   - `feat:` — new feature (minor version bump)
   - `fix:` — bug fix (patch version bump)
   - `feat!:` or `fix!:` — breaking change (major version bump)

2. **Release Please opens/updates a release PR** — this PR accumulates changes and updates the changelog

3. **Merge the release PR** — this triggers the npm publish

4. **Changelog draft is created automatically** — after publish, the workflow generates a changelog draft using the GitHub release and PR descriptions, and sends a Slack notification to review and publish the release in Studio.

### Changelog CLI

You can also manage changelog entries locally:

```bash
pnpm release-notes preview 0.3.4        # Preview what would be created
pnpm release-notes create 0.3.4         # Create documents
pnpm release-notes delete 0.3.4         # Delete documents
```

Requires a `.env` file in `scripts/release-notes/` — see `.env.example` for the required variables.

# Skills

## Reference implementation syncing

The `create-agent-with-sanity-context` skill includes reference files from the ecommerce example so AI agents can learn from working code. To keep these in sync:

- **Source of truth**: `examples/ecommerce/`
- **Synced copy**: `skills/create-agent-with-sanity-context/references/ecommerce/`

Direct edits to the `references/ecommerce/` folder are blocked:

- A pre-commit hook prevents local commits
- A CI check fails PRs that modify these files directly

When changes to `examples/ecommerce/` are merged to `main`, the `sync-skill-references` workflow automatically syncs them and opens a PR. Edit the example, not the references.
