import { EXECUTION_MESSAGE_CHANNEL } from '@shared/mobile-work/execution-html'
import { MobileExecutionService } from '@shared/mobile-work/MobileExecutionService'
import { expect, it, vi } from 'vitest'
import { receiveExecutionMessage } from './execution-message'

it('accepts only the current opaque frame, token, channel and job identity', () => {
  const frame = {} as Window
  const otherFrame = {} as Window
  const service = new MobileExecutionService()
  const receive = vi.spyOn(service, 'receive')
  const payload = {
    channel: EXECUTION_MESSAGE_CHANNEL,
    token: 'secret',
    id: 'current',
    result: { stdout: 'ok', files: {} },
  }
  const event = { source: frame, origin: 'null', data: JSON.stringify(payload) }
  receiveExecutionMessage({ ...event, source: otherFrame }, frame, 'current', 'secret', service)
  receiveExecutionMessage({ ...event, origin: 'https://evil.example' }, frame, 'current', 'secret', service)
  receiveExecutionMessage(event, frame, 'current', 'wrong', service)
  receiveExecutionMessage(event, frame, 'stale', 'secret', service)
  receiveExecutionMessage(
    { ...event, data: JSON.stringify({ ...payload, channel: 'other' }) },
    frame,
    'current',
    'secret',
    service
  )
  expect(receive).not.toHaveBeenCalled()
  receiveExecutionMessage(event, frame, 'current', 'secret', service)
  expect(receive).toHaveBeenCalledWith('current', payload.result)
})
