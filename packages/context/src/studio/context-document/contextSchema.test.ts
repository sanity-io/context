import {describe, expect, it} from 'vitest'

import {
  AGENT_CONTEXT_SCHEMA_TYPE_NAME,
  agentContextSchema,
  CONTEXT_SCHEMA_TYPE_NAME,
  contextSchema,
} from './contextSchema'

describe('contextSchema', () => {
  it('should have the correct schema type name', () => {
    expect(contextSchema.name).toBe(CONTEXT_SCHEMA_TYPE_NAME)
    expect(contextSchema.name).toBe('sanity.agentContext')
  })

  it('should be a document type', () => {
    expect(contextSchema.type).toBe('document')
  })

  describe('deprecated aliases', () => {
    it('should export agentContextSchema as alias', () => {
      expect(agentContextSchema).toBe(contextSchema)
    })

    it('should export AGENT_CONTEXT_SCHEMA_TYPE_NAME as alias', () => {
      expect(AGENT_CONTEXT_SCHEMA_TYPE_NAME).toBe(CONTEXT_SCHEMA_TYPE_NAME)
    })
  })

  describe('version field', () => {
    it('should correctly define the version field with type string and hidden: true', () => {
      const versionField = contextSchema.fields.find((field) => field.name === 'version')

      expect(versionField).toBeDefined()
      expect(versionField?.type).toBe('string')
      expect((versionField as {hidden?: boolean})?.hidden).toBe(true)
    })

    it("should include an initialValue of '1' for the version field", () => {
      expect(contextSchema.initialValue).toBeDefined()
      expect(contextSchema.initialValue).toHaveProperty('version', '1')
    })
  })

  describe('other fields', () => {
    it('should include the name field', () => {
      const nameField = contextSchema.fields.find((field) => field.name === 'name')
      expect(nameField).toBeDefined()
      expect(nameField?.type).toBe('string')
    })

    it('should include the slug field', () => {
      const slugField = contextSchema.fields.find((field) => field.name === 'slug')
      expect(slugField).toBeDefined()
      expect(slugField?.type).toBe('slug')
    })

    it('should include the groqFilter field', () => {
      const groqFilterField = contextSchema.fields.find((field) => field.name === 'groqFilter')
      expect(groqFilterField).toBeDefined()
      expect(groqFilterField?.type).toBe('string')
    })

    it('should include the instructions field', () => {
      const instructionsField = contextSchema.fields.find((field) => field.name === 'instructions')
      expect(instructionsField).toBeDefined()
      expect(instructionsField?.type).toBe('text')
    })
  })
})
