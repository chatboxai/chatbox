import { describe, expect, it, vi } from 'vitest'
import { reportNativeContent } from './native-report'

describe('reportNativeContent', () => {
  it('submits only the content identifier, selected type, and empty details', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })))

    await reportNativeContent({
      apiOrigin: 'https://report.test/',
      details: '',
      fetchFn,
      id: 'message text',
      type: 'Other concerns',
    })

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://report.test/api/report_content')
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      id: 'message text',
      type: 'Other concerns',
      details: '',
    })
  })
})
