import {ChartUpwardIcon} from '@sanity/icons'
import {definePlugin} from 'sanity'
import {route} from 'sanity/router'

import {CONVERSATION_SCHEMA_TYPE_NAME} from '../insights/constants'
import {
  CONTEXT_SCHEMA_TITLE,
  CONTEXT_SCHEMA_TYPE_NAME,
  contextSchema,
} from './context-document/contextSchema'
import {InsightsDashboard} from './insights/dashboard/InsightsDashboard'
import {CONVERSATION_SCHEMA_TITLE, conversationSchema} from './insights/schemas/conversationSchema'

/** @public */
export interface InsightsOptions {
  /**
   * Whether to enable the insights feature.
   * @defaultValue true
   */
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
  /**
   * Configuration for the insights feature.
   * Omit to use defaults; set `enabled` to `false` to disable.
   */
  insights?: InsightsOptions
}

/** @public @deprecated Use `ContextPluginOptions` instead. */
export type AgentContextPluginOptions = ContextPluginOptions

/**
 * The Sanity Context plugin.
 * @beta
 */
export const contextPlugin = definePlugin<ContextPluginOptions | void>((options = {}) => {
  const shouldRegisterContextDocument = options?.registerContextDocument !== false
  const insightsEnabled = options?.insights?.enabled !== false

  const schemaTypes = [
    ...(shouldRegisterContextDocument ? [contextSchema] : []),
    ...(insightsEnabled ? [conversationSchema] : []),
  ]

  const schemaTemplates = [
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
    ...(insightsEnabled
      ? [
          {
            id: CONVERSATION_SCHEMA_TYPE_NAME,
            title: CONVERSATION_SCHEMA_TITLE,
            schemaType: CONVERSATION_SCHEMA_TYPE_NAME,
            value: {},
          },
        ]
      : []),
  ]

  return {
    name: 'sanity/context/plugin',
    schema: {
      types: schemaTypes,
      templates: (prev) => [...prev, ...schemaTemplates],
    },
    tools: insightsEnabled
      ? [
          {
            name: 'agent-insights',
            title: 'Agent Insights',
            icon: ChartUpwardIcon,
            component: InsightsDashboard,
            router: route.create('/:path', [route.create('/:agentId', [route.create('/:id')])]),
          },
        ]
      : [],
  }
})

/** @public @deprecated Use `contextPlugin` instead. */
export const agentContextPlugin = contextPlugin
