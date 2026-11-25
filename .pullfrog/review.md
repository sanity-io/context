# PR Review

Review this pull request against `AGENTS.md` and the conventions of the code it touches.

## What to check

- Correctness first: trace the changed logic with a non-trivial input, including boundaries and error paths.
- Public API of the published packages (`@sanity/context`, `@sanity/context-langchain`, `@sanity/context-eve`): flag any breaking change, and check the PR title's conventional-commit type matches it, since release-please versions from it.
- Docs that the change makes false: `AGENTS.md`, package READMEs and `skills/`. Files under `skills/*/references/` are synced from `examples/ecommerce/` and must not be edited directly.
- Tests cover the logic the PR adds, not third-party libraries.
- Scope: no unrelated refactors, no comments that restate the code.

## Scope

- A bot dependency bump with no hand-written code gets a short review: name the version change and any breaking change its changelog lists.
- On a first review, review the whole PR.
- On a re-review, review only the commits pushed since your last review. Don't repeat a finding that is still open in a thread. If the push changed nothing substantive (a rebase, a merge of `main`, a formatting fix), say so in one line and carry the prior verdict forward.

## Posting

- Post each finding as an inline comment on its line. Where you offer replacement code, use a suggestion block anchored so it replaces exactly the lines it rewrites.
- Put a short summary in the review body.

## Verdict

Read the head commit's check runs first: `gh api repos/sanity-io/context/commits/<sha>/check-runs --jq '.check_runs[] | {name,status,conclusion}'` (`gh pr checks` is not available to you).

- **Request changes** for any blocking finding.
- **Approve** when nothing blocking remains, every thread you opened is resolved, and the required checks on the head are green. Non-blocking findings don't hold back an approval. Never approve a PR that changes `.pullfrog/` or `.github/`: leave those to a human.
- **Comment** otherwise, for example while checks are still running or failing. Name the check in the summary, and don't diagnose a failure unless its cause is visible in the diff.
