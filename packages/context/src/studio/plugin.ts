import {definePlugin} from 'sanity'
import {route} from 'sanity/router'

import {
  CONTEXT_SCHEMA_TITLE,
  CONTEXT_SCHEMA_TYPE_NAME,
  contextSchema,
} from './context-document/contextSchema'
import {ChartUpwardIcon} from './icons'
import {InsightsMovedNotice} from './MovedNotice'

/**
 * @public
 * @deprecated Insights has moved to the Context app; these options are ignored.
 */
export interface InsightsOptions {
  /** @deprecated Ignored. */
  enabled?: boolean
}

/**
 * The options for the context plugin.
 * @public
 */
export interface ContextPluginOptions {
  /**
   * Register the Sanity Context document type.
   * @defaultValue true
   */
  registerContextDocument?: boolean
  /** @deprecated Insights has moved to the Context app; this option is ignored. */
  insights?: InsightsOptions
}

/** @public @deprecated Use `ContextPluginOptions` instead. */
export type AgentContextPluginOptions = ContextPluginOptions

/**
 * The Sanity Context plugin.
 * @beta
 * @deprecated Configuration and Insights have moved to the Context app in the Sanity Dashboard.
 * See the migration guide: https://www.sanity.io/docs/ai/context-migration-guide
 */
export const contextPlugin = definePlugin<ContextPluginOptions | void>((options = {}) => {
  const shouldRegisterContextDocument = options?.registerContextDocument !== false

  return {
    name: 'sanity/context/plugin',
    schema: {
      types: shouldRegisterContextDocument ? [contextSchema] : [],
      templates: (prev) => [
        ...prev,
        ...(shouldRegisterContextDocument
          ? [
              {
                id: CONTEXT_SCHEMA_TYPE_NAME,
                title: CONTEXT_SCHEMA_TITLE,
                schemaType: CONTEXT_SCHEMA_TYPE_NAME,
                value: {},
              },
            ]
          : []),
      ],
    },
    tools: [
      {
        name: 'agent-insights',
        title: 'Agent Insights',
        icon: ChartUpwardIcon,
        component: InsightsMovedNotice,
        router: route.create('/:path', [route.create('/:agentId', [route.create('/:id')])]),
      },
    ],
  }
})

/** @public @deprecated Use `contextPlugin` instead. */
export const agentContextPlugin = contextPlugin
