import {generateText as generateTextV6} from 'ai'
import {MockLanguageModelV3} from 'ai/test'
import {generateText as generateTextV7} from 'ai-v7'
import {MockLanguageModelV4} from 'ai-v7/test'
import {describe, expect, it, vi} from 'vitest'

import {makeClientStub} from '../../insights/clientStub'
import {sanityInsightsIntegration} from './telemetryIntegration'

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

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        finishReason: {unified: 'stop' as const, raw: 'stop'},
        usage: {
          inputTokens: {total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined},
          outputTokens: {total: 5, text: undefined, reasoning: undefined},
        },
        content: [{type: 'text' as const, text: 'Hello from v6'}],
        warnings: [],
      }),
    })

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

    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        finishReason: {unified: 'stop' as const, raw: 'stop'},
        usage: {
          inputTokens: {total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined},
          outputTokens: {total: 5, text: undefined, reasoning: undefined},
        },
        content: [{type: 'text' as const, text: 'Hello from v7'}],
        warnings: [],
      }),
    })

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
})
