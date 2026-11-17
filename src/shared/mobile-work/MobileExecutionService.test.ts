import { expect, it } from 'vitest'
import { MobileExecutionService } from './MobileExecutionService'

it('creates a fresh job for each execution', async () => {
  const service = new MobileExecutionService()
  const result = service.execute('1', {}, new AbortController().signal)
  await Promise.resolve()
  await Promise.resolve()
  const firstId = service.getSnapshot()!.id
  expect(service.getSnapshot()?.code).toBe('1')
  service.receive(service.getSnapshot()!.id, { stdout: '', files: {} })
  await result
  const next = service.execute('2', {}, new AbortController().signal)
  await Promise.resolve()
  await Promise.resolve()
  expect(service.getSnapshot()?.code).toBe('2')
  expect(service.getSnapshot()?.id).not.toBe(firstId)
  service.receive(service.getSnapshot()!.id, { stdout: '', files: {} })
  await next
})

it('stops background execution and permits a fresh retry after returning', async () => {
  const service = new MobileExecutionService()
  const first = service.execute('1', {}, new AbortController().signal)
  const rejected = expect(first).rejects.toThrow('WORK_FOREGROUND_REQUIRED')
  await Promise.resolve()
  await Promise.resolve()
  service.setForeground(false)
  await rejected
  expect(service.getSnapshot()).toBeNull()
  await expect(service.execute('2', {}, new AbortController().signal)).rejects.toThrow('WORK_FOREGROUND_REQUIRED')
  service.setForeground(true)
  const retry = service.execute('3', {}, new AbortController().signal)
  await Promise.resolve()
  await Promise.resolve()
  service.receive(service.getSnapshot()!.id, { stdout: 'done', files: {} })
  expect(await retry).toEqual({ stdout: 'done', files: {} })
})
