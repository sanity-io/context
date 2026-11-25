# eve Support Agent with Sanity Context

A customer support chat for your website, built with [eve](https://eve.dev), [Jev](https://vercel.com/i/what-is-jev) and [Sanity Context](https://www.sanity.io/docs/ai/sanity-context). Visitors ask questions, and the agent answers from your own content instead of guessing.

It follows one rule: **Jev decides. Code enforces. The model writes.**

1. **Jev decides.** Before each answer, Jev, a decision model from TypeSafe AI, answers three questions about the message in one request, in about 300 ms: what does the customer want, how hard is it, and which Knowledge Base entry has the answer?
2. **Code enforces.** A short rules file turns those answers into the turn: it puts the right entry in the prompt, picks Claude Haiku or Claude Sonnet, or hands the customer to your support team.
3. **The model writes.** One model call, with the answer already in front of it. No search round trips.

It's a small version of the agent we run on sanity.io, following [The 0.5-second Jev agent](https://www.sanity.io/engineering/the-0-5-second-agent).

## Why Jev and Sanity Context work well together

Most agents spend their first seconds searching: the model writes a query, waits for results, reads them, and often tries again. Sanity Context does that work ahead of time. A Knowledge Base compiles your content into organized entries with a short index, a bit like a site that's built ahead of time instead of rendered on every request.

That index turns "find the answer" into a choice from a known list, which is exactly what Jev is built for:

- **A choice, not a search.** Jev picks the entry from your index in a few hundred milliseconds, and it can only pick an entry that exists.
- **It knows when a question spans two entries.** Jev returns a probability for every entry, so the agent reads both when a question needs them.
- **Better content, better routing.** Jev reads each entry's summary. Your content team keeps entries clear in Sanity, and routing improves without a code change.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsanity-io%2Fcontext%2Ftree%2Fmain%2Fexamples%2Feve-support&project-name=eve-support-agent&repository-name=eve-support-agent&env=SANITY_CONTEXT_MCP_URL,SANITY_ORGANIZATION_TOKEN&envDescription=Your%20Sanity%20Context%20MCP%20endpoint%20URL%20and%20an%20organization%20token%20with%20the%20Context%20permission&envLink=https%3A%2F%2Fgithub.com%2Fsanity-io%2Fcontext%2Ftree%2Fmain%2Fexamples%2Feve-support%23what-you-need)

Deploy asks for your Context endpoint URL and token, then deploys the web chat and the agent as one Vercel project. Jev and both writing models run through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) with your project's credentials, so you don't need any model API keys.

## What you need

- **A Sanity Context MCP endpoint.** Create one in the Context app in the Sanity Dashboard, from Knowledge Bases (built from your website, files or datasets) or from a dataset, and copy its URL. New to Sanity? [Get started](https://www.sanity.io/get-started?ref=context).
- **An organization API token with the Context permission.** Create it in Manage under your organization's API > Tokens, with Context set to Viewer. Project tokens don't work.

## How it works

```text
agent/
  agent.ts                  picks this turn's model from the route
  hooks/decide.ts           loads the Knowledge Base index, asks Jev, applies the rules
  lib/knowledge-base.ts     reads your endpoint's outline and entries (cached for 5 minutes)
  lib/decide.ts             the three questions Jev answers
  lib/rules.ts              Jev's answers → model, instructions, content and tools
  instructions/role.md      how the agent answers
  instructions/route.ts     this turn's rule
  instructions/content.ts   the entries looked up for this question
  connections/sanity.ts     search tools, only when the rules ask for a search
  channels/eve.ts           who can use the chat
apps/web/                   the web chat (Next.js)
evals/                      smoke, routing and conversation evals
```

On every message:

| Jev says                                        | The rules do                                                              | Model                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| A question, and one entry answers it            | Put the entry in the prompt, no tools                                     | Haiku 5.5 (quick) or Sonnet 5.5 (careful) |
| A question that spans two entries               | Put both entries in the prompt, no tools                                  | Sonnet 5.5                                |
| A question no entry covers                      | Hand off to your support team                                             | Haiku 5.5                                 |
| Needs a person (an order, a refund, an account) | Hand off to your support team, no lookup                                  | Haiku 5.5                                 |
| Small talk, or junk and off-topic requests      | One short reply, no lookup                                                | Haiku 5.5                                 |
| Not sure, or Jev unavailable                    | Search with the Sanity Context tools, then hand off if nothing answers it | Sonnet 5.5                                |

The web chat shows which model answered, how soon it started and whether it looked anything up. The terminal logs every Jev decision.

**What the agent knows** comes from your Sanity Context endpoint. The agent reads its Knowledge Base outline and entries directly, and Jev picks from them by each entry's summary. Support teams change what the agent knows, and how it behaves, in the Context app without a deploy. The endpoint needs at least one Knowledge Base; with a dataset-only endpoint every question takes the search route.

## What we measured

10 customer support questions, each run 2 to 3 times against a Bird Rock Outfitters Knowledge Base (fictional surf shop), on eve 1.4 and the Vercel AI Gateway:

|                              | Sonnet with search tools (no Jev) | This template |
| ---------------------------- | --------------------------------- | ------------- |
| Median time to a full answer | 7.4 s                             | 1.8 s         |
| Model calls per answer       | 3                                 | 1             |
| Input tokens per answer      | about 9,200                       | about 1,200   |
| Cost per 1,000 answers       | about $11                         | about $1      |

Both versions gave the same answers on these questions. Your numbers depend on your content and questions: run the evals.

## Make it yours

- **Routing:** edit the models, thresholds, support contact and wording in `agent/lib/rules.ts`.
- **What Jev looks for:** edit the intent and effort options in `agent/lib/decide.ts`. Jev only knows each option by its description, so keep them specific and give examples. Entry options come from your entries' first paragraphs, so a clear first paragraph helps Jev pick the right one.
- **Hand-offs:** connect your helpdesk (Zendesk, Intercom, a Slack channel) where `agent/lib/rules.ts` says so.
- **How it answers:** edit `agent/instructions/role.md`, or the endpoint's Instructions in the Context app.
- **What visitors see first:** edit the title, starter questions and the model note in `apps/web/app/support-config.ts`.

## Before you go live

The chat is public, like most support chats: `none()` in `agent/channels/eve.ts` lets anyone on your site ask a question. The agent can only read the endpoint you connected, so serve it only content you'd publish anyway.

- **Add a rate limit** on `/eve/v1/*` with a [Vercel Firewall](https://vercel.com/docs/vercel-firewall) rule.
- **Set a spend limit** for the [AI Gateway](https://vercel.com/docs/ai-gateway).
- **To make the chat private,** replace `none()` with your auth provider. See [eve authentication](https://eve.dev/docs/guides/auth-and-route-protection).

## Run locally

```bash
pnpm install
cp .env.example .env.local   # add your endpoint URL, token and AI Gateway key
pnpm dev:all                 # web chat and agent at http://localhost:3000
```

Try one of each: a one-fact question, a question that combines two policies, "Where is my order #1234?", something your content doesn't cover, and "Hi!". `pnpm dev` starts the agent alone in eve's terminal UI.

## Evals

```bash
pnpm eval
```

- `evals/smoke.eval.ts` answers one question end to end.
- `evals/routing.eval.ts` sends one message of each kind and checks the model and that no search was needed.
- `evals/conversation.eval.ts` checks that a later message doesn't take back an earlier answer.

Replace the messages with real ones from your customers and content.

## Troubleshooting

- `Sanity Context initial context failed (401)` or `(403)`: use an organization token with the Context permission, from the same organization as the endpoint. Project tokens don't work.
- Every question takes the search route: the endpoint has no Knowledge Base, or Jev is unavailable. Check the `Jev` line in the logs.
- `Jev decision skipped` in the logs: the AI Gateway call to `typesafe-ai/jev` failed. The agent still answers, by searching with the careful model.

## Learn more

- [How to build an agent that closes business and helps users](https://www.sanity.io/engineering/how-to-build-an-agent-that-closes-business) and [The 0.5-second Jev agent](https://www.sanity.io/engineering/the-0-5-second-agent)
- [Sanity Context](https://www.sanity.io/docs/ai/sanity-context) and [Connect Sanity Context with Vercel eve](https://www.sanity.io/docs/context/connect-vercel-eve)
- [Decisions on the AI Gateway](https://vercel.com/docs/ai-gateway/modalities/decision)
- [eve documentation](https://eve.dev/docs)

## License

MIT. See [LICENSE](./LICENSE).
