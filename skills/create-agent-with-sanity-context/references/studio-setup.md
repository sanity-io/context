# Studio Setup

Configure the Sanity Context plugin in your Studio and create Sanity Context documents.

> **Reference Implementation**: See [ecommerce/\_index.md](ecommerce/_index.md) for file navigation, then explore [ecommerce/studio/](ecommerce/studio/).

## Contents

- [Install the Package](#install-the-package)
- [Add the Plugin](#add-the-plugin)
- [Customize Structure Tool](#customize-structure-tool-optional)
- [Create a Sanity Context document](#create-a-sanity-context-document)
- [Get the MCP URL](#get-the-mcp-url)
- [Deploy Your Studio](#deploy-your-studio)
- [Create an Agent Config Document](#create-an-agent-config-document-optional)
- [Environment Variables](#environment-variables)
- [Schema Reference](#schema-reference)

---

## Install the Package

```bash
npm install @sanity/context
# or
pnpm add @sanity/context
```

**IMPORTANT: Always check [ecommerce/studio/package.json](ecommerce/studio/package.json) for current working versions.** Key dependencies:

| Package                 | Notes                                     |
| ----------------------- | ----------------------------------------- |
| `@sanity/context` | Use `latest` or check npm for version     |
| `sanity`                | v5.1.0+ required (for server-side schema) |
| `@sanity/vision`        | Must match Sanity version                 |
| `react`, `react-dom`    | React 19                                  |

Do NOT guess versions—check the reference `package.json` or use `npm info <package> version` to get the latest.

## Add the Plugin

See [ecommerce/studio/sanity.config.ts](ecommerce/studio/sanity.config.ts) for a complete example (look for: imports, `plugins` array, `schema.types`).

**Minimal setup:**

```ts
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {contextPlugin} from '@sanity/context/studio'

export default defineConfig({
  // ... your config
  plugins: [structureTool(), contextPlugin()],
})
```

This registers the `sanity.agentContext` document type and enables Insights (conversation tracking dashboard) in your Studio.

**Disable Insights** (if you don't need conversation tracking):

```ts
contextPlugin({insights: false})
```

## Update the Structure Tool

Check whether `structureTool()` in the Studio config has a `structure` prop. If it does, the Studio uses an explicit structure — document types only appear in the sidebar if they are listed there. The Sanity Context types (`CONTEXT_SCHEMA_TYPE_NAME`, `CONVERSATION_SCHEMA_TYPE_NAME`) must be added to the existing structure, or they will be invisible. If there is no `structure` prop, types appear automatically and no changes are needed.

See [ecommerce/studio/sanity.config.ts](ecommerce/studio/sanity.config.ts) for an example that groups agent types under an "Agents" section. Adapt the placement to match the project's existing organization.

## Create a Sanity Context document

There are two ways to create and edit Sanity Context documents:

1. **Via Sanity MCP (recommended)**: You can create, copy, and edit Sanity Context documents directly using the Sanity MCP. When modifying a document that's already in use by a production agent, create a duplicate first so you don't interfere with the live setup. This is how the `dial-your-context` skill writes instructions and filters during a tuning session.

   ```bash
   # Install if needed
   npx sanity@latest mcp configure
   ```

2. **Via Sanity Studio**: The user can create and edit documents manually through the Studio UI. Use this when you don't have Sanity MCP access, or when the user prefers to manage documents directly.

A Sanity Context document (type: `sanity.agentContext`) has these fields:

| Field          | Schema field   | Description                                               |
| -------------- | -------------- | --------------------------------------------------------- |
| Name           | `name`         | Display name (e.g., "Product Assistant")                  |
| Slug           | `slug`         | URL identifier, auto-generated from name                  |
| Content Filter | `groqFilter`   | GROQ filter scoping what content the agent can access     |
| Instructions   | `instructions` | Custom instructions for how agents work with your content |

### Content Filter Examples

**All documents of specific types:**

```groq
_type in ["article", "product", "category"]
```

**Published content only:**

```groq
_type in ["article", "product"] && !(_id in path("drafts.**"))
```

**Content in a specific language:**

```groq
_type == "article" && language == "en"
```

**Products within a category:**

```groq
_type == "product" && references(*[_type == "category" && slug.current == "electronics"]._id)
```

The filter UI provides two modes:

- **Types tab**: Simple UI to select document types
- **GROQ tab**: Manual entry for complex filters

## Get the MCP URL

Once the Sanity Context document has a slug, the MCP URL appears at the top of the document form:

```
https://api.sanity.io/v2026-03-03/context/mcp/:projectId/:dataset/:slug
```

Copy this URL—you'll need it when configuring the agent.

## Deploy Your Studio

Sanity Context requires a **deployed Studio** (not just running locally) running **v5.1.0+**.

### Sanity-Hosted Studios

For Studios hosted on Sanity infrastructure:

```bash
npx sanity deploy
```

After deploying, the user needs to open the Studio in the browser to trigger schema deployment.

### Externally Hosted Studios

For Studios hosted on the user's own infrastructure (requires Sanity CLI **v5.8.0+**):

```bash
npx sanity deploy --external --schema-required
```

This registers the Studio's external URL with Sanity and ensures the schema is deployed (which Sanity Context requires).

> **Note:** The `--external` flag skips building and uploading the Studio bundle, and only registers the external host URL. The `--schema-required` flag ensures schema deployment happens and fails fast if it fails, which is important since Sanity Context relies on the schema store.

## Create an Agent Config Document (Optional)

The reference implementation stores the base system prompt in a Sanity document (`agent.config`). See [ecommerce/studio/schemaTypes/documents/agentConfig.ts](ecommerce/studio/schemaTypes/documents/agentConfig.ts) for the schema.

## Environment Variables

See [ecommerce/studio/.env.example](ecommerce/.env.example) for the template.

Required variables:

```bash
SANITY_STUDIO_PROJECT_ID=your-project-id
SANITY_STUDIO_DATASET=production
```

## Schema Reference

The reference implementation includes a complete e-commerce schema. See [ecommerce/studio/schemaTypes/](ecommerce/studio/schemaTypes/):

- **Documents**: [product.ts](ecommerce/studio/schemaTypes/documents/product.ts), [category.ts](ecommerce/studio/schemaTypes/documents/category.ts), [brand.ts](ecommerce/studio/schemaTypes/documents/brand.ts), [agentConfig.ts](ecommerce/studio/schemaTypes/documents/agentConfig.ts)
- **Objects**: [productVariant.ts](ecommerce/studio/schemaTypes/objects/productVariant.ts), [price.ts](ecommerce/studio/schemaTypes/objects/price.ts), [seo.ts](ecommerce/studio/schemaTypes/objects/seo.ts)

These schemas demonstrate patterns for structured content that agents can query effectively.

## Next Steps

With the Studio configured, deployed, and a Sanity Context document created, update the agent's MCP URL to use the slug-based URL to apply the document's configuration.
