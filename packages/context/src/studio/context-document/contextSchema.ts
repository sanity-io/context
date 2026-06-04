import {DatabaseIcon} from '@sanity/icons'
import {defineField, defineType} from 'sanity'

import {ContextDocumentInput} from './context-document-input/ContextDocumentInput'
import {GroqFilterInput} from './groq-filter-input/GroqFilterInput'
import {validateGroqFilter} from './groq-filter-input/groqUtils'
import {KnowledgeBaseInput} from './knowledge-base-input/KnowledgeBaseInput'

/** @public */
export const CONTEXT_SCHEMA_TYPE_NAME = 'sanity.agentContext'

/** @public @deprecated Use `CONTEXT_SCHEMA_TYPE_NAME` instead. */
export const AGENT_CONTEXT_SCHEMA_TYPE_NAME = CONTEXT_SCHEMA_TYPE_NAME

/** @internal */
export const CONTEXT_SCHEMA_TITLE = 'Sanity Context'

/** @internal @deprecated Use `CONTEXT_SCHEMA_TITLE` instead. */
export const AGENT_CONTEXT_SCHEMA_TITLE = CONTEXT_SCHEMA_TITLE

/** @public */
export const contextSchema = defineType({
  name: CONTEXT_SCHEMA_TYPE_NAME,
  title: CONTEXT_SCHEMA_TITLE,
  type: 'document',
  icon: DatabaseIcon,
  initialValue: {
    version: '1',
    mode: 'groq',
  },
  components: {
    input: ContextDocumentInput,
  },
  fields: [
    defineField({
      name: 'version',
      title: 'Version',
      type: 'string',
      hidden: true,
    }),
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      placeholder: 'My Sanity Context',
      description: 'The name of this Sanity Context',
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      validation: (Rule) => Rule.required(),
      description: 'The slug of this context. This is used to identify it in the MCP URL.',
      options: {
        source: 'name',
      },
    }),
    defineField({
      name: 'mode',
      title: 'Content access mode',
      type: 'string',
      validation: (Rule) => Rule.required(),
      options: {
        list: [
          {title: 'Knowledge base', value: 'knowledge_base'},
          {title: 'GROQ', value: 'groq'},
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'knowledgeBaseIds',
      title: 'Knowledge bases',
      description:
        'Give agents access to curated knowledge bases so they can find and use that content when answering.',
      type: 'array',
      of: [{type: 'string'}],
      hidden: ({parent}) => parent?.mode !== 'knowledge_base',
      components: {
        input: KnowledgeBaseInput,
      },
    }),
    defineField({
      name: 'groqFilter',
      title: 'Content filter',
      description:
        'Control what content AI agents can access. Leave empty for full access, or pick specific document types. Use the GROQ tab for advanced filters.',
      type: 'string',
      hidden: ({parent}) => parent?.mode !== 'groq',
      components: {
        input: GroqFilterInput,
      },
      validation: (Rule) => {
        return Rule.custom((value) => {
          const result = validateGroqFilter(value)

          return result.valid ? true : result.error || 'Invalid GROQ filter'
        })
      },
    }),
    defineField({
      name: 'instructions',
      title: 'Instructions',
      description: 'Custom instructions for how AI agents should work with your content.',
      type: 'text',
    }),
  ],
})

/** @public @deprecated Use `contextSchema` instead. */
export const agentContextSchema = contextSchema
