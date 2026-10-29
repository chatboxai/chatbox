// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionArtifactRequest } from '@chatbox/core/ports'

const mocks = vi.hoisted(() => ({
  read: vi.fn<(request: SessionArtifactRequest) => AsyncIterable<string>>(),
  show: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessions: { iterateSessionArtifactMarkdown: mocks.read } },
}))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: mocks.show } }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/lib/utils', () => ({ cn: (...values: string[]) => values.join(' ') }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (value: string) => value }) }))
import { MessageArtifact } from './Artifact'

const props = {
  sessionId: 's',
  messageId: 'target',
  messageContent: '```html\n<div>current</div>\n```',
  preview: false,
  setPreview: vi.fn(),
}
function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockImplementation(async function* () {
    yield '```css\nbody { color: red }\n```'
  })
})
afterEach(cleanup)

describe('lazy message artifacts', () => {
  it('does not read history on a closed preview mount or live content update', () => {
    const view = render(<MessageArtifact {...props} />)
    view.rerender(<MessageArtifact {...props} messageContent={'```html\nnew stream'} />)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy()
  })

  it('opens fullscreen from a closed preview with historical styles and current content', async () => {
    render(<MessageArtifact {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    expect(screen.getByText('Loading...')).toBeTruthy()
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1))
    expect(mocks.show.mock.calls[0][1]).toMatchObject({
      htmlCode: expect.stringContaining('body { color: red }'),
      sessionId: 's',
    })
    expect(mocks.show.mock.calls[0][1].htmlCode).toContain('<div>current</div>')
    expect(props.setPreview).not.toHaveBeenCalled()
  })

  it('starts history after preview is enabled and reuses only the code summary for streaming content', async () => {
    const view = render(<MessageArtifact {...props} />)
    view.rerender(<MessageArtifact {...props} preview />)
    await waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull())
    view.rerender(<MessageArtifact {...props} preview messageContent={'```html\n<div>latest</div>\n```'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1))
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.show.mock.calls[0][1].htmlCode).toContain('<div>latest</div>')
    expect(mocks.show.mock.calls[0][1].htmlCode).toContain('body { color: red }')
  })

  it('aborts closed previews and rejects late code from a replaced target', async () => {
    const pending = deferred()
    mocks.read.mockImplementationOnce(async function* () {
      await pending.promise
      yield '```css\n.stale {}\n```'
    })
    const view = render(<MessageArtifact {...props} preview />)
    const signal = mocks.read.mock.calls[0][0].signal
    view.rerender(<MessageArtifact {...props} sessionId="other" messageId="new" />)
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(mocks.show).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1))
    expect(mocks.show.mock.calls[0][1]).toMatchObject({ sessionId: 'other', uniqueId: 'new-artifact' })
    expect(mocks.show.mock.calls[0][1].htmlCode).not.toContain('.stale')
  })

  it('shows a load failure and lets the next explicit open retry', async () => {
    mocks.read.mockImplementationOnce(async function* () {
      throw new Error('read failed')
    })
    render(<MessageArtifact {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(mocks.show).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1))
  })
})
