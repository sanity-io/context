# Pullfrog settings

[Pullfrog](https://pullfrog.com/docs) reviews PRs and fixes CI in this repo. Its prompts are console fields, and each field only points at a file here, so the files are what Pullfrog follows. Change a prompt by editing its file in a PR.

| File        | Console field (`pullfrog config` key)               |
| ----------- | --------------------------------------------------- |
| `review.md` | Review PRs → Custom instructions (`prompts.review`) |
| `fix-ci.md` | `prompts.fix-ci`                                    |

Each field holds this pointer, with `<file>` replaced:

```
Check out the pull request first (if there is one), then follow .pullfrog/<file> from that checkout. If it has no .pullfrog/ directory, read the file from main instead: git fetch origin main && git show origin/main:.pullfrog/<file>
```

A run starts on the default branch and switches to the PR only when it checks it out, so the pointer fixes the order: the PR's copy is read, and a PR that edits a file is handled under its own edit. Pullfrog never approves a PR that changes `.pullfrog/` or `.github/`. Fields not listed here use Pullfrog's defaults. To take one over, add a file and set its field to a pointer.

The setup hook (`pnpm install --frozen-lockfile`) stays in the console. A hook can't fall back to `main`, so pointing it at a file would break runs on branches cut before that file existed.

Only collaborators start runs. This is a public repo, so the console keeps every "non-collaborator" and "external contributor" option off. Turning one on lets anyone spend the API key.
