import {defineField, defineType} from 'sanity'

import {CONVERSATION_SCHEMA_TYPE_NAME} from '../../../insights/constants'

/**
 * @internal
 */
export const CONVERSATION_SCHEMA_TITLE = 'Agent Conversation'

/**
 * Message object schema for conversation messages
 */
const messageObjectSchema = defineField({
  type: 'object',
  name: 'conversationMessage',
  title: 'Message',
  fields: [
    defineField({
      name: 'role',
      title: 'Role',
      type: 'string',
      options: {
        list: [
          {title: 'User', value: 'user'},
          {title: 'Assistant', value: 'assistant'},
          {title: 'System', value: 'system'},
          {title: 'Tool', value: 'tool'},
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'content',
      title: 'Content',
      type: 'text',
    }),
    defineField({
      name: 'toolName',
      title: 'Tool Name',
      type: 'string',
      description: 'For tool messages: the name of the tool',
    }),
    defineField({
      name: 'toolType',
      title: 'Tool Type',
      type: 'string',
      description: 'For tool messages: whether this is a call or result',
      options: {
        list: [
          {title: 'Call', value: 'call'},
          {title: 'Result', value: 'result'},
        ],
      },
    }),
  ],
})

/**
 * Core metrics fields - these fields are fixed and controlled by Sanity.
 * Used for standardized classification of conversations.
 */
const coreMetricsFields = [
  defineField({
    name: 'successScore',
    title: 'Success Score',
    type: 'number',
    description: 'How successfully the agent addressed user needs (1-10)',
    validation: (Rule) => Rule.min(1).max(10).integer(),
  }),
  defineField({
    name: 'sentiment',
    title: 'Sentiment',
    type: 'string',
    options: {
      list: [
        {title: 'Positive', value: 'positive'},
        {title: 'Neutral', value: 'neutral'},
        {title: 'Negative', value: 'negative'},
      ],
    },
  }),
  defineField({
    name: 'contentGaps',
    title: 'Content Gaps',
    type: 'array',
    of: [{type: 'string'}],
    description: 'Topics where the agent lacked information in its knowledge base',
  }),
]

/**
 * @public
 */
export const conversationSchema = defineType({
  name: CONVERSATION_SCHEMA_TYPE_NAME,
  title: CONVERSATION_SCHEMA_TITLE,
  type: 'document',
  fields: [
    // Identity
    defineField({
      name: 'agentId',
      title: 'Agent ID',
      type: 'string',
      description: 'Identifier for the agent that handled this conversation',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'threadId',
      title: 'Thread ID',
      type: 'string',
      description: 'Unique identifier for this conversation thread',
      validation: (Rule) => Rule.required(),
    }),

    // Messages
    defineField({
      name: 'messages',
      title: 'Messages',
      type: 'array',
      of: [messageObjectSchema],
    }),

    // Timestamps
    defineField({
      name: 'startedAt',
      title: 'Started At',
      type: 'datetime',
      description: 'When the conversation started',
    }),
    defineField({
      name: 'messagesUpdatedAt',
      title: 'Messages Updated At',
      type: 'datetime',
      description: 'When the conversation messages were last updated',
    }),

    // Model info
    defineField({
      name: 'modelProvider',
      title: 'Model Provider',
      type: 'string',
      description: 'The AI model provider (e.g. "openai", "anthropic")',
    }),
    defineField({
      name: 'modelId',
      title: 'Model ID',
      type: 'string',
      description: 'The AI model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514")',
    }),
    defineField({
      name: 'tokenUsage',
      title: 'Token Usage',
      type: 'object',
      description: 'Aggregated token usage for the conversation',
      fields: [
        defineField({
          name: 'inputTokens',
          title: 'Input Tokens',
          type: 'number',
        }),
        defineField({
          name: 'outputTokens',
          title: 'Output Tokens',
          type: 'number',
        }),
        defineField({
          name: 'totalTokens',
          title: 'Total Tokens',
          type: 'number',
        }),
      ],
    }),

    // Classification - populated by classifyConversation()
    defineField({
      name: 'coreMetrics',
      title: 'Core Metrics',
      type: 'object',
      description: 'Standardized metrics from automated classification',
      fields: coreMetricsFields,
    }),
    defineField({
      name: 'classifiedAt',
      title: 'Classified At',
      type: 'datetime',
      description: 'When this conversation was classified',
    }),
    defineField({
      name: 'classificationError',
      title: 'Classification Error',
      type: 'string',
      description: 'Error message if classification failed',
    }),
  ],

  preview: {
    select: {
      agentId: 'agentId',
      threadId: 'threadId',
      startedAt: 'startedAt',
      successScore: 'coreMetrics.successScore',
    },
    prepare({agentId, threadId, startedAt, successScore}) {
      const date = startedAt ? new Date(startedAt).toLocaleDateString() : 'Unknown date'
      const score = successScore !== undefined ? ` - Score: ${successScore}/10` : ''

      return {
        title: `${agentId} - ${threadId}`,
        subtitle: `${date}${score}`,
      }
    },
  },
})
