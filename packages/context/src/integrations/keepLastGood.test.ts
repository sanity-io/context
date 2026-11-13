import {expect, it, vi} from 'vitest'

import {keepLastGood} from './keepLastGood'

it('falls back to the last success and only throws before the first one', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error('down'))
    .mockResolvedValueOnce('one')
    .mockRejectedValueOnce(new Error('down'))
  const get = keepLastGood('the tools', load)
  await expect(get()).rejects.toThrow('down')
  expect(await get()).toBe('one')
  expect(await get()).toBe('one')
})
