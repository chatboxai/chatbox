/** @vitest-environment jsdom */
import { SessionRepositoryError } from '@chatbox/core/ports'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionStartupRecovery } from './coordinator'
import { createStartupDiagnostic, formatStartupDiagnostic } from './diagnostics'

afterEach(() => sessionStartupRecovery.clearForTests())

describe('session startup diagnostics', () => {
  it('retains a safe cause and code locations without exposing paths or arbitrary error data', () => {
    const error = new Error('Active thread projection is unavailable')
    error.stack =
      'Error: private content\n    at readHeader (http://localhost/js/index.abc.js:266:40220)\n    at read (/Users/private-user/project/src/read.ts:12:9)'
    const diagnostic = createStartupDiagnostic(error, 'read')
    expect(diagnostic.message).toBe(error.message)
    expect(diagnostic.stack).toBe('at index.abc.js:266:40220\nat read.ts:12:9')
    const text = formatStartupDiagnostic(diagnostic, { version: '1.24.0', platform: 'mobile/android' })
    expect(text).toContain('Stage: read')
    expect(text).not.toMatch(/private content|private-user|localhost/)
    const sensitive = new Error(
      'SQL failed: {"messages":"my conversation", "api_key":"sk-secret", "license":"private-license"}'
    )
    expect(JSON.stringify(createStartupDiagnostic(sensitive, 'read'))).not.toMatch(
      /my conversation|sk-secret|private-license/
    )
    expect(JSON.stringify(createStartupDiagnostic({ message: 'private', token: 'secret' }, 'read'))).not.toContain(
      'secret'
    )
  })

  it('retains one diagnostic through repeat failures, replaces it for a different error, and clears on success', () => {
    const error = new Error('database is locked')
    sessionStartupRecovery.fail('s', error)
    const first = sessionStartupRecovery.getDiagnostic('s')
    if (!first) throw new Error('missing diagnostic')
    sessionStartupRecovery.fail('s', error)
    expect(sessionStartupRecovery.getDiagnostic('s')).toBe(first)
    sessionStartupRecovery.setReportId('s', first, 'confirmed')
    expect(sessionStartupRecovery.getDiagnostic('s')?.reportId).toBe('confirmed')
    sessionStartupRecovery.fail('s', new Error('Active thread projection is unavailable'))
    expect(sessionStartupRecovery.getDiagnostic('s')?.reportId).toBeUndefined()
    sessionStartupRecovery.setReportId('s', first, 'late')
    expect(sessionStartupRecovery.getDiagnostic('s')?.reportId).toBeUndefined()
    sessionStartupRecovery.settle('s')
    expect(sessionStartupRecovery.getDiagnostic('s')).toBeUndefined()
  })

  it('does not fabricate an exception for a previous interrupted process', () => {
    localStorage.setItem('chatbox.sessionStartupInflight', JSON.stringify({ sessionId: 's', startedAt: 1 }))
    sessionStartupRecovery.promotePreviousAttempt()
    expect(sessionStartupRecovery.getDiagnostic('s')).toBeUndefined()
    expect(formatStartupDiagnostic(undefined, { version: '1', platform: 'web' })).toContain(
      'No error details were recorded'
    )
  })

  it('forgets diagnostics with a deleted session without touching another session', () => {
    sessionStartupRecovery.fail('s', new Error('database is locked'))
    sessionStartupRecovery.fail('other', new Error('database is locked'))
    sessionStartupRecovery.forget(['s'])
    expect(sessionStartupRecovery.getDiagnostic('s')).toBeUndefined()
    expect(sessionStartupRecovery.getDiagnostic('other')).toBeDefined()
  })
})

it('extracts the underlying repository cause without exposing its session ID', () => {
  const cause = new Error('database is locked')
  cause.stack = 'Error: database is locked\n at read (/private/storage.js:10:20)'
  const diagnostic = createStartupDiagnostic(new SessionRepositoryError('get-session', cause, 'private-id'), 'read')
  expect(diagnostic.message).toBe('database is locked')
  expect(diagnostic.stack).toBe('at storage.js:10:20')
  expect(JSON.stringify(diagnostic)).not.toContain('private-id')
})

it('keeps the first frame of header-less stacks and never parses multi-line exception headers as frames', () => {
  const safari = new Error('database is locked')
  safari.stack =
    'readHeader@capacitor://localhost/assets/index.abc.js:3:14\nread@capacitor://localhost/assets/read.js?v=1:5:6'
  const header = createStartupDiagnostic(safari, 'read')
  expect(header.stack).toBe('at index.abc.js:3:14\nat read.js:5:6')
  expect(header.reportStack).toBe(
    '    at capacitor://localhost/assets/index.abc.js:3:14\n    at capacitor://localhost/assets/read.js:5:6'
  )
  const multiline = new Error('first line\nsee /Users/private-user/secret-notes.js:1:1')
  multiline.stack = `Error: ${multiline.message}\n    at read (file:///app/out/renderer/assets/index.js:7:8)`
  const diagnostic = createStartupDiagnostic(multiline, 'read')
  expect(diagnostic.stack).toBe('at index.js:7:8')
  expect(JSON.stringify(diagnostic)).not.toMatch(/secret-notes|private-user/)
})
