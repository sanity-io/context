# Adapting to Different Stacks

The MCP connection pattern is framework and LLM-agnostic. This guide shows how to adapt the core pattern to different frameworks and AI libraries.

## Contents

- [The Universal Pattern](#the-universal-pattern)
- [Different Frameworks](#different-frameworks)
- [Different AI Libraries](#different-ai-libraries)
- [Questions to Ask Users](#questions-to-ask-users)

---

## The Universal Pattern

Regardless of framework, the integration follows this flow:

```
1. Fetch initial context via HTTP (${MCP_URL}/initial-context) — cache the result
2. Create MCP client with HTTP transport
3. Authenticate with Sanity API token
4. Get tools from MCP client
5. Build system prompt with initial context injected
6. Pass tools to your LLM along with system prompt
7. Handle tool calls and responses
8. Clean up MCP connection when done
```

---

## Initial Context via HTTP

Append `/initial-context` to the MCP URL **path** (before any query params) to fetch the schema context as plain HTTP. Same auth header, same query params. Cache the result and inject it into your system prompt:

```ts
const url = new URL(MCP_URL)
url.pathname = `${url.pathname.replace(/\/$/, '')}/initial-context`

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${API_TOKEN}` },
})
const initialContext = await response.text()

const systemPrompt = `${BASE_PROMPT}\n\n# Content context\n\n${initialContext}`
```

This eliminates the `initial_context` tool call on every first message and enables prompt caching (the schema prefix is stable across conversations).

---

## Different Frameworks

**Express/Node.js**

```ts
app.post('/api/chat', async (req, res) => {
  const [mcpClient, initialContext] = await Promise.all([
    createMCPClient({
      transport: {
        type: 'http',
        url: process.env.SANITY_CONTEXT_MCP_URL,
        headers: {Authorization: `Bearer ${process.env.SANITY_API_READ_TOKEN}`},
      },
    }),
    fetchInitialContext(), // See "Initial Context via HTTP" above
  ])
  const tools = await mcpClient.tools()
  // Include initialContext in system prompt, pass tools to LLM...
})
```

**Remix**

```ts
export async function action({request}: ActionFunctionArgs) {
  const mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: process.env.SANITY_CONTEXT_MCP_URL,
      headers: {Authorization: `Bearer ${process.env.SANITY_API_READ_TOKEN}`},
    },
  })
  const tools = await mcpClient.tools()
  // Pass tools to your LLM, handle response...
}
```

**Python/FastAPI**

```python
import httpx
from mcp import Client, HttpTransport

# Fetch initial context via HTTP
async def fetch_initial_context() -> str:
    from urllib.parse import urlparse, urlunparse
    parsed = urlparse(os.environ["SANITY_CONTEXT_MCP_URL"])
    url = urlunparse(parsed._replace(path=parsed.path.rstrip("/") + "/initial-context"))
    async with httpx.AsyncClient() as http:
        resp = await http.get(
            url,
            headers={"Authorization": f"Bearer {os.environ['SANITY_API_READ_TOKEN']}"},
        )
        return resp.text

client = Client(
    transport=HttpTransport(
        url=os.environ["SANITY_CONTEXT_MCP_URL"],
        headers={"Authorization": f"Bearer {os.environ['SANITY_API_READ_TOKEN']}"}
    )
)
initial_context, tools = await fetch_initial_context(), await client.get_tools()
# Include initial_context in system prompt, pass tools to LLM...
```

---

## Different AI Libraries

**LangChain**: Wrap MCP tools as LangChain tools

```ts
const mcpTools = await mcpClient.tools()
const langchainTools = mcpTools.map(
  (tool) =>
    new DynamicTool({
      name: tool.name,
      description: tool.description,
      func: async (input) => mcpClient.callTool(tool.name, JSON.parse(input)),
    }),
)
```

**Direct Anthropic API**: Pass tool definitions directly

```ts
const tools = await mcpClient.tools()
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  system: systemPrompt,
  messages,
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  })),
})
```

---

## Questions to Ask Users

When adapting this pattern, understand:

1. **"What framework are you using?"** — Determines route/endpoint structure
2. **"What AI SDK or library?"** — Determines how tools are passed to the LLM
3. **"What's the agent's purpose?"** — Shapes the system prompt
4. **"What content types will it access?"** — Informs the GROQ filter in Studio
5. **"Streaming or request/response?"** — Affects response handling
