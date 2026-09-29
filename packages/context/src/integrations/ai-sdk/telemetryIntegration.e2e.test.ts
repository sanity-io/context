import {generateText as generateTextV6, stepCountIs, tool as toolV6} from 'ai'
import {MockLanguageModelV3} from 'ai/test'
import {generateText as generateTextV7, isStepCount, tool as toolV7} from 'ai-v7'
import {MockLanguageModelV4} from 'ai-v7/test'
import {describe, expect, it, vi} from 'vitest'
import {z} from 'zod'

import {makeClientStub} from '../../insights/clientStub'
import {sanityInsightsIntegration} from './telemetryIntegration'

const usage = {
  inputTokens: {total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined},
  outputTokens: {total: 5, text: undefined, reasoning: undefined},
}

const callTool = (toolName: string) => ({
  finishReason: {unified: 'tool-calls' as const, raw: 'tool_use'},
  usage,
  content: [{type: 'tool-call' as const, toolCallId: toolName, toolName, input: '{}'}],
  warnings: [],
})

const reply = (text: string) => ({
  finishReason: {unified: 'stop' as const, raw: 'stop'},
  usage,
  content: [{type: 'text' as const, text}],
  warnings: [],
})

const failingTool = async (): Promise<{ok: boolean}> => {
  throw new Error('db down')
}

/**
 * Backwards/forwards compatibility against the real AI SDK majors: each test
 * runs an actual generateText call and asserts the SDK's telemetry bus
 * invokes the integration and the full payload reaches the client. The unit
 * tests drive the hooks directly; these prove each SDK version still does.
 */
describe('sanityInsightsIntegration end-to-end', () => {
  it('saves a conversation through AI SDK v6 experimental_telemetry', async () => {
    const {client, save} = makeClientStub()
    save.mockResolvedValue({threadId: 't-v6'})

    const model = new MockLanguageModelV3({doGenerate: async () => reply('Hello from v6')})

    await generateTextV6({
      model,
      messages: [{role: 'user', content: 'Hi'}],
      experimental_telemetry: {
        isEnabled: true,
        integrations: [sanityInsightsIntegration({client, threadId: 't-v6'})],
      },
    })
    await vi.waitFor(() => expect(save).toHaveBeenCalled())

    expect(save).toHaveBeenCalledExactlyOnceWith({
      threadId: 't-v6',
      messages: [
        {role: 'user', content: 'Hi'},
        {role: 'assistant', content: 'Hello from v6'},
      ],
      modelProvider: 'mock-provider',
      modelId: 'mock-model-id',
      tokenUsage: {inputTokens: 10, outputTokens: 5, totalTokens: 15},
    })
  })

  it('saves a conversation through AI SDK v7 telemetry', async () => {
    const {client, save} = makeClientStub()
    save.mockResolvedValue({threadId: 't-v7'})

    const model = new MockLanguageModelV4({doGenerate: async () => reply('Hello from v7')})

    await generateTextV7({
      model,
      messages: [{role: 'user', content: 'Hi'}],
      telemetry: {
        integrations: [sanityInsightsIntegration({client, threadId: 't-v7'})],
      },
    })
    await vi.waitFor(() => expect(save).toHaveBeenCalled())

    expect(save).toHaveBeenCalledExactlyOnceWith({
      threadId: 't-v7',
      messages: [
        {role: 'user', content: 'Hi'},
        {role: 'assistant', content: 'Hello from v7'},
      ],
      modelProvider: 'mock-provider',
      modelId: 'mock-model-id',
      tokenUsage: {inputTokens: 10, outputTokens: 5, totalTokens: 15},
    })
  })

  it.each([
    {
      version: 'v6',
      toolError: 'db down',
      run: (integration: ReturnType<typeof sanityInsightsIntegration>) => {
        const steps = [callTool('lookup'), reply('Sorry, that failed')]
        return generateTextV6({
          model: new MockLanguageModelV3({doGenerate: async () => steps.shift()!}),
          messages: [{role: 'user', content: 'Hi'}],
          stopWhen: stepCountIs(3),
          tools: {lookup: toolV6({inputSchema: z.object({}), execute: failingTool})},
          experimental_telemetry: {isEnabled: true, integrations: [integration]},
        })
      },
    },
    {
      version: 'v7',
      toolError: 'Error: db down',
      run: (integration: ReturnType<typeof sanityInsightsIntegration>) => {
        const steps = [callTool('lookup'), reply('Sorry, that failed')]
        return generateTextV7({
          model: new MockLanguageModelV4({doGenerate: async () => steps.shift()!}),
          messages: [{role: 'user', content: 'Hi'}],
          stopWhen: isStepCount(3),
          tools: {lookup: toolV7({inputSchema: z.object({}), execute: failingTool})},
          telemetry: {integrations: [integration]},
        })
      },
    },
  ])(
    'saves a failed tool call with its error through AI SDK $version',
    async ({run, toolError}) => {
      const {client, save} = makeClientStub()
      save.mockResolvedValue({threadId: 't'})

      await run(sanityInsightsIntegration({client, threadId: 't'}))
      await vi.waitFor(() => expect(save).toHaveBeenCalled())

      expect(save.mock.calls[0]![0].messages).toEqual([
        {role: 'user', content: 'Hi'},
        {role: 'tool', toolName: 'lookup', toolType: 'call', content: '{}'},
        {
          role: 'tool',
          toolName: 'lookup',
          toolType: 'result',
          content: null,
          error: toolError,
        },
        {role: 'assistant', content: 'Sorry, that failed'},
      ])
    },
  )

  it('saves the transcript so far plus the error when an AI SDK v7 turn fails', async () => {
    const {client, save} = makeClientStub()
    save.mockResolvedValue({threadId: 't'})
    const steps = [callTool('lookup')]

    await expect(
      generateTextV7({
        model: new MockLanguageModelV4({
          doGenerate: async () => steps.shift() ?? Promise.reject(new Error('Overloaded')),
        }),
        messages: [{role: 'user', content: 'Hi'}],
        stopWhen: isStepCount(3),
        tools: {
          lookup: toolV7({inputSchema: z.object({}), execute: async () => ({ok: true})}),
        },
        telemetry: {integrations: [sanityInsightsIntegration({client, threadId: 't'})]},
      }),
    ).rejects.toThrow('Overloaded')
    await vi.waitFor(() => expect(save).toHaveBeenCalled())

    expect(save.mock.calls[0]![0].messages).toEqual([
      {role: 'user', content: 'Hi'},
      {role: 'tool', toolName: 'lookup', toolType: 'call', content: '{}'},
      {
        role: 'assistant',
        content: null,
        error: expect.stringMatching(/^Error: Overloaded\n\s+at /),
      },
    ])
  })
})
