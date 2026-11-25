import {localDev, none, vercelOidc} from 'eve/channels/auth'
import {eveChannel} from 'eve/channels/eve'

export default eveChannel({
  auth: [
    // Lets the eve TUI and your own Vercel deployments reach the agent.
    vercelOidc(),
    // Open on localhost for `eve dev`.
    localDev(),
    // A customer support chat is public: anyone on your site can ask a question.
    // The agent can only read the Sanity Context endpoint you connected, so keep
    // that endpoint to content you'd publish anyway. Before launch, add a
    // rate limit and an AI Gateway spend limit (see "Before you go live" in the
    // README). To make the chat private, replace none() with your auth provider.
    none(),
  ],
})
