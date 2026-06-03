import {
  CONTEXT_SCHEMA_TYPE_NAME,
  contextPlugin,
  CONVERSATION_SCHEMA_TYPE_NAME,
} from '@sanity/context/studio'
import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {type ListItemBuilder, type StructureBuilder, structureTool} from 'sanity/structure'
import {markdownSchema} from 'sanity-plugin-markdown'

import {schemaTypes} from './schemaTypes'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET
const apiHost = process.env.SANITY_STUDIO_API_HOST

if (!projectId) {
  throw new Error('Missing SANITY_STUDIO_PROJECT_ID environment variable')
}

if (!dataset) {
  throw new Error('Missing SANITY_STUDIO_DATASET environment variable')
}

export default defineConfig({
  name: 'default',
  title: process.env.SANITY_STUDIO_TITLE || 'Clothing PIM',

  projectId,
  dataset,
  ...(apiHost && {apiHost}),

  plugins: [
    structureTool({
      structure: (S: StructureBuilder) => {
        // Document types to group under "Agents"
        const agentTypes = [CONTEXT_SCHEMA_TYPE_NAME, CONVERSATION_SCHEMA_TYPE_NAME, 'agent.config']

        // Get all schema types except agent-related types
        const defaultListItems = S.documentTypeListItems().filter(
          (item: ListItemBuilder) => !agentTypes.includes(item.getId() ?? ''),
        )

        return S.list()
          .title('Content')
          .items([
            ...defaultListItems,
            S.divider(),
            // Group agent related document types together
            S.listItem()
              .title('Agents')
              .child(
                S.list()
                  .title('Agents')
                  .items([
                    S.documentTypeListItem('agent.config').title('Agent Configs'),
                    S.documentTypeListItem(CONTEXT_SCHEMA_TYPE_NAME).title('Agent Contexts'),
                    S.documentTypeListItem(CONVERSATION_SCHEMA_TYPE_NAME).title('Conversations'),
                  ]),
              ),
          ])
      },
    }),
    visionTool(),
    contextPlugin(),
    markdownSchema(),
  ],

  schema: {
    types: schemaTypes,
  },
})
