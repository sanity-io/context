import {ChartUpwardIcon} from '@sanity/icons/ChartUpward'
import {definePlugin} from 'sanity'
import {route} from 'sanity/router'

import {InsightsMovedNotice} from './MovedNotice'

/**
 * @public
 * @deprecated The plugin no longer registers schema types; these options are ignored.
 */
export interface InsightsOptions {
  /** @deprecated Ignored. */
  enabled?: boolean
}

/**
 * The options for the context plugin.
 * @public
 * @deprecated The plugin no longer registers schema types; these options are ignored.
 */
export interface ContextPluginOptions {
  /** @deprecated Ignored. */
  registerContextDocument?: boolean
  /** @deprecated Ignored. */
  insights?: InsightsOptions
}

/** @public @deprecated Use `ContextPluginOptions` instead. */
export type AgentContextPluginOptions = ContextPluginOptions

/**
 * The Sanity Context plugin.
 * @beta
 * @deprecated Configuration and Insights have moved to the Context app in the Sanity Dashboard.
 */
export const contextPlugin = definePlugin<ContextPluginOptions | void>(() => {
  return {
    name: 'sanity/context/plugin',
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
