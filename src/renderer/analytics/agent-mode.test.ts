import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/track', () => ({
  trackEvent: vi.fn(),
}))

import { trackEvent } from '@/utils/track'
import { trackAgentModeSuggested } from './agent-mode'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('trackAgentModeSuggested', () => {
  it('sends bucketed props only', () => {
    trackAgentModeSuggested({ hasFiles: true, fileCount: 3 })
    expect(trackEvent).toHaveBeenCalledWith('agent_mode_suggested', {
      has_files: 'true',
      file_count: '2_plus',
    })
  })
})
