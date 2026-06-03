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
  // Group the direct-query toggle and its content filter into one bordered,
  // collapsible section. They stay top-level fields in the document (no nested
  // object), so consumers read `groqEnabled` / `groqFilter` unchanged.
  fieldsets: [
    {
      name: 'directQuery',
      title: 'Direct content access',
      description: 'Let agents query your content directly, and scope what they can reach.',
      options: {collapsible: true, collapsed: false},
    },
  ],
  initialValue: {
    version: '1',
    groqEnabled: true,
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
      name: 'knowledgeBaseIds',
      title: 'Knowledge bases',
      description:
        'Give agents access to curated knowledge bases so they can find and use that content when answering.',
      type: 'array',
      of: [{type: 'string'}],
      components: {
        input: KnowledgeBaseInput,
      },
    }),
    defineField({
      name: 'groqEnabled',
      title: 'Let agents query all content',
      description:
        'Allow agents to search across all your content directly. Stays on when no knowledge base is attached, so agents always have a way to find content.',
      type: 'boolean',
      fieldset: 'directQuery',
    }),
    defineField({
      name: 'groqFilter',
      title: 'Content filter',
      description:
        'Control what content AI agents can access. Leave empty for full access, or pick specific document types. Use the GROQ tab for advanced filters.',
      type: 'string',
      fieldset: 'directQuery',
      // The filter only scopes direct querying, so it's inactive (read-only)
      // when that's off — kept visible (not hidden) so there's no layout jump.
      readOnly: ({parent}) => parent?.groqEnabled === false,
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
