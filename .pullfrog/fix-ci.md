Fix the failing CI on this pull request. Follow `AGENTS.md`.

- Read the failing step's log before changing anything. Find the first real error, not the last line.
- Fix the cause in the PR's own changes. Don't skip, loosen or delete a test or check to make it pass, and don't change code the PR didn't touch unless the failure is there.
- If the failure is a flake or is unrelated to the PR (an outage, a rate limit, a failure that also happens on `main`), don't push a change. Say what failed and why you think it is unrelated.
- Never edit `skills/*/references/` by hand. Change `examples/ecommerce/` instead.
- Before pushing, run `pnpm check:types`, `pnpm check:lint`, `pnpm check:format` and `pnpm test:unit`. Use a Conventional Commit message.
