import {describe, expect, it} from 'vitest'

import {buildSystemPrompt, formatMessagesForPrompt} from './classifyConversation'

describe('formatMessagesForPrompt', () => {
  it('formats messages with capitalized roles', () => {
    const messages = [
      {role: 'user', content: 'Hello'},
      {role: 'assistant', content: 'Hi there'},
    ]

    const result = formatMessagesForPrompt(messages)

    expect(result).toBe('[User]: Hello\n\n[Assistant]: Hi there')
  })

  it('handles empty content', () => {
    const messages = [{role: 'user', content: ''}]

    const result = formatMessagesForPrompt(messages)

    expect(result).toBe('[User]: (no content)')
  })

  it('handles all role types', () => {
    const messages = [
      {role: 'system', content: 'You are helpful'},
      {role: 'user', content: 'Hi'},
      {role: 'assistant', content: 'Hello'},
      {role: 'tool', content: 'Tool result'},
    ]

    const result = formatMessagesForPrompt(messages)

    expect(result).toContain('[System]:')
    expect(result).toContain('[User]:')
    expect(result).toContain('[Assistant]:')
    expect(result).toContain('[Tool]:')
  })

  it('returns empty string for empty array', () => {
    const result = formatMessagesForPrompt([])
    expect(result).toBe('')
  })
})

describe('buildSystemPrompt', () => {
  it('returns base prompt when no previous gaps provided', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('You are analyzing a conversation')
    expect(prompt).not.toContain('Previously identified content gaps')
  })

  it('returns base prompt when previous gaps is empty array', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).not.toContain('Previously identified content gaps')
  })

  it('includes previous gaps as bulleted list when provided', () => {
    const prompt = buildSystemPrompt(['billing info', 'return policy'])
    expect(prompt).toContain('Previously identified content gaps')
    expect(prompt).toContain('- billing info')
    expect(prompt).toContain('- return policy')
  })

  it('instructs the model to reuse existing terms', () => {
    const prompt = buildSystemPrompt(['billing info'])
    expect(prompt).toContain('reuse these exact terms when they match')
    expect(prompt).toContain('only create new terms for genuinely new topics')
  })
})
