// @vitest-environment jsdom

import { createTheme, ThemeProvider } from '@mui/material/styles'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDbSchemaGuardStore } from '@/storage/db-schema-guard'
import { ClientNotificationWindow, type ClientNotificationWindowDependencies } from './ClientNotificationWindow'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

const notification = {
  batch_id: '018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc41',
  title: '更新说明',
  subtitle: '1.22 版本',
  body_markdown: '本次更新内容',
  content_language: 'zh' as const,
}

function createDependencies(
  overrides: Partial<ClientNotificationWindowDependencies> = {}
): ClientNotificationWindowDependencies {
  return {
    getLanguage: vi.fn().mockResolvedValue('zh-Hans'),
    getNextNotification: vi.fn().mockResolvedValue(notification),
    markBatchDisplayed: vi.fn(),
    openLink: vi.fn(),
    readDisplayedBatchIds: vi.fn().mockReturnValue(['018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc40']),
    withDisplayLock: (display) => display(),
    trackImpression: vi.fn(),
    trackLinkClick: vi.fn(),
    ...overrides,
  }
}

function mockMedia({ coarse = false, narrow = false }: { coarse?: boolean; narrow?: boolean } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
      matches: query.includes('pointer: coarse') ? coarse : query.includes('max-width') ? narrow : false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  })
}

describe('ClientNotificationWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMedia()
    useDbSchemaGuardStore.setState({
      schemaTooNewDbName: null,
      upgradedElsewhereDbName: null,
      upgradeBlockedDbName: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function mockVisibility(initial: DocumentVisibilityState = 'visible') {
    let state = initial
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
    return (next: DocumentVisibilityState) => {
      state = next
      act(() => document.dispatchEvent(new Event('visibilitychange')))
    }
  }

  it('does not consume a hidden response before another visible window receives it', async () => {
    const setVisibility = mockVisibility('hidden')
    const displayed: string[] = []
    const a = createDependencies({
      readDisplayedBatchIds: () => [...displayed],
      markBatchDisplayed: vi.fn((id) => displayed.push(id)),
      withDisplayLock: vi.fn((show) => show()),
    })
    const hidden = render(<ClientNotificationWindow dependencies={a} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(a.getNextNotification).toHaveBeenCalledOnce()
    expect(a.withDisplayLock).not.toHaveBeenCalled()
    expect(a.markBatchDisplayed).not.toHaveBeenCalled()
    expect(a.trackImpression).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    hidden.unmount()
    setVisibility('visible')
    const b = createDependencies({
      readDisplayedBatchIds: a.readDisplayedBatchIds,
      markBatchDisplayed: a.markBatchDisplayed,
    })
    render(<ClientNotificationWindow dependencies={b} />)
    await waitFor(() => expect(b.trackImpression).toHaveBeenCalledOnce())
    expect(displayed).toEqual([notification.batch_id])
  })

  it('shows a fetched notification when a hidden page becomes visible without refetching', async () => {
    const setVisibility = mockVisibility('hidden')
    const dependencies = createDependencies()
    render(<ClientNotificationWindow dependencies={dependencies} />)
    await act(async () => {
      await Promise.resolve()
    })
    setVisibility('visible')
    await waitFor(() => expect(dependencies.trackImpression).toHaveBeenCalledOnce())
    expect(dependencies.getNextNotification).toHaveBeenCalledOnce()
  })

  it('does not claim a queued lock after going hidden and rechecks history on return', async () => {
    const setVisibility = mockVisibility()
    const callbacks: Array<() => Promise<void>> = []
    const displayed: string[] = []
    const dependencies = createDependencies({
      withDisplayLock: vi.fn((show) => {
        callbacks.push(show)
        return Promise.resolve()
      }),
      readDisplayedBatchIds: () => [...displayed],
    })
    render(<ClientNotificationWindow dependencies={dependencies} />)
    await waitFor(() => expect(callbacks).toHaveLength(1))
    setVisibility('hidden')
    await act(() => callbacks[0]())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(dependencies.trackImpression).not.toHaveBeenCalled()
    displayed.push(notification.batch_id)
    setVisibility('visible')
    await waitFor(() => expect(callbacks).toHaveLength(2))
    await act(() => callbacks[1]())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(dependencies.trackImpression).not.toHaveBeenCalled()
  })

  it('releases the lock when hidden during entry and only consumes on a visible entry', async () => {
    const setVisibility = mockVisibility()
    const released = vi.fn()
    const dependencies = createDependencies({
      withDisplayLock: async (show) => {
        await show()
        released()
      },
    })
    render(<ClientNotificationWindow dependencies={dependencies} />)
    await screen.findByRole('dialog')
    expect(dependencies.trackImpression).not.toHaveBeenCalled()
    setVisibility('hidden')
    await waitFor(() => expect(released).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(dependencies.markBatchDisplayed).not.toHaveBeenCalled()
    expect(dependencies.trackImpression).not.toHaveBeenCalled()
    setVisibility('visible')
    await waitFor(() => expect(dependencies.trackImpression).toHaveBeenCalledOnce())
    setVisibility('hidden')
    await waitFor(() => expect(released).toHaveBeenCalledTimes(2))
    setVisibility('visible')
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(dependencies.markBatchDisplayed).toHaveBeenCalledOnce()
    expect(dependencies.trackImpression).toHaveBeenCalledOnce()
  })

  it.each(['schemaTooNewDbName', 'upgradedElsewhereDbName', 'upgradeBlockedDbName'] as const)(
    'waits for %s to clear before showing and consuming a fetched notification',
    async (field) => {
      let resolve!: (value: typeof notification) => void
      const dependencies = createDependencies({
        getNextNotification: () =>
          new Promise((done) => {
            resolve = done
          }),
      })
      render(<ClientNotificationWindow dependencies={dependencies} />)
      await waitFor(() => expect(resolve).toBeTypeOf('function'))
      await act(async () => {
        useDbSchemaGuardStore.setState({ [field]: 'test-db' })
        resolve(notification)
        await Promise.resolve()
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(dependencies.markBatchDisplayed).not.toHaveBeenCalled()
      expect(dependencies.trackImpression).not.toHaveBeenCalled()
      act(() => useDbSchemaGuardStore.setState({ [field]: null }))
      await screen.findByRole('dialog')
      await waitFor(() => expect(dependencies.trackImpression).toHaveBeenCalledOnce())
    }
  )

  it.each([false, true])('shows a shared batch in only one window (late response: %s)', async (late) => {
    const displayed: string[] = []
    let queue = Promise.resolve()
    const withDisplayLock: ClientNotificationWindowDependencies['withDisplayLock'] = (show) => {
      const next = queue.then(show)
      queue = next
      return next
    }
    let resolveA!: (value: typeof notification) => void
    let resolveB!: (value: typeof notification) => void
    const a = createDependencies({
      withDisplayLock,
      readDisplayedBatchIds: () => [...displayed],
      markBatchDisplayed: (id) => {
        displayed.push(id)
      },
      getNextNotification: () =>
        new Promise((done) => {
          resolveA = done
        }),
    })
    const b = createDependencies({
      ...a,
      trackImpression: vi.fn(),
      getNextNotification: () =>
        new Promise((done) => {
          resolveB = done
        }),
    })
    render(
      <>
        <ClientNotificationWindow dependencies={a} />
        <ClientNotificationWindow dependencies={b} />
      </>
    )
    await waitFor(() => expect(resolveB).toBeTypeOf('function'))
    await act(async () => {
      resolveA(notification)
      if (!late) resolveB(notification)
      await Promise.resolve()
    })
    await waitFor(() => expect(a.trackImpression).toHaveBeenCalledOnce())
    if (late) await act(() => Promise.resolve(resolveB(notification)))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await act(async () => {
      await queue
    })
    expect(b.trackImpression).not.toHaveBeenCalled()
    expect(displayed).toEqual([notification.batch_id])
  })

  it('requests at most one notification and marks the batch only after the dialog becomes visible', async () => {
    const dependencies = createDependencies()

    render(<ClientNotificationWindow dependencies={dependencies} />)

    expect(dependencies.markBatchDisplayed).not.toHaveBeenCalled()
    expect((await screen.findByRole('dialog')).textContent).toContain('更新说明')

    await waitFor(() => expect(dependencies.markBatchDisplayed).toHaveBeenCalledWith(notification.batch_id))
    expect(dependencies.getNextNotification).toHaveBeenCalledOnce()
    expect(dependencies.getNextNotification).toHaveBeenCalledWith({
      locale: 'zh-Hans',
      displayed_batch_ids: ['018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc40'],
    })
    expect(dependencies.trackImpression).toHaveBeenCalledWith(notification)
  })

  it('still displays the notification once when React StrictMode replays effects', async () => {
    const dependencies = createDependencies()

    render(
      <StrictMode>
        <ClientNotificationWindow dependencies={dependencies} />
      </StrictMode>
    )

    expect((await screen.findByRole('dialog')).textContent).toContain('更新说明')
    expect(dependencies.getNextNotification).toHaveBeenCalledOnce()
  })

  it('offers only a fixed acknowledgement button without a close icon', async () => {
    const dependencies = createDependencies()

    render(<ClientNotificationWindow dependencies={dependencies} />)

    await screen.findByRole('dialog')
    const closeButton = screen.getByRole('button', { name: 'Got it' })
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)

    fireEvent.click(closeButton)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('separates the title and subtitle from the notification body', async () => {
    const dependencies = createDependencies()

    render(<ClientNotificationWindow dependencies={dependencies} />)

    await screen.findByRole('dialog')
    const subtitle = screen.getByText('1.22 版本')
    const body = screen.getByText('本次更新内容')

    expect(subtitle.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('renders Markdown separators inside the notification body', async () => {
    const dependencies = createDependencies({
      getNextNotification: vi.fn().mockResolvedValue({
        ...notification,
        body_markdown: '第一段\n\n***\n\n第二段',
      }),
    })

    render(<ClientNotificationWindow dependencies={dependencies} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByRole('separator')).toHaveLength(1)
  })

  it('preserves single line breaks in the notification body', async () => {
    const dependencies = createDependencies({
      getNextNotification: vi.fn().mockResolvedValue({
        ...notification,
        body_markdown: '测试\n测试\n测试\n\n1. 全新设计\n应用界面重绘\n2. 多端同步\n* 同步说明\n3. 性能优化',
      }),
    })

    render(<ClientNotificationWindow dependencies={dependencies} />)

    const paragraph = await screen.findByText((_, element) =>
      Boolean(element?.tagName === 'P' && element.textContent === '测试\n测试\n测试')
    )
    expect(getComputedStyle(paragraph).whiteSpace).toBe('pre-line')
    const item = screen.getByText((_, element) =>
      Boolean(element?.tagName === 'LI' && element.textContent === '全新设计\n应用界面重绘')
    )
    expect(getComputedStyle(item).whiteSpace).toBe('pre-line')
    expect(screen.getByText('性能优化').closest('ol')?.start).toBe(3)
  })

  it('uses the compact notification typography and dialog width', async () => {
    const dependencies = createDependencies()

    render(<ClientNotificationWindow dependencies={dependencies} />)

    const dialog = await screen.findByRole('dialog')
    const title = screen.getByRole('heading', { name: '更新说明', level: 2 })
    const subtitle = screen.getByText('1.22 版本')
    const body = screen.getByText('本次更新内容')
    const closeButton = screen.getByRole('button', { name: 'Got it' })
    const bodyContainer = body.parentElement

    expect(getComputedStyle(dialog).maxWidth).toBe('571px')
    expect(getComputedStyle(dialog.parentElement as HTMLElement).alignItems).toBe('center')
    expect(getComputedStyle(dialog).borderRadius).toBe('24px')
    expect(getComputedStyle(title).fontSize).toBe('20px')
    expect(getComputedStyle(subtitle).fontSize).toBe('12px')
    expect(bodyContainer).not.toBeNull()
    expect(getComputedStyle(bodyContainer as HTMLElement).fontSize).toBe('13px')
    expect(getComputedStyle(bodyContainer as HTMLElement).lineHeight).toBe('18px')
    expect(getComputedStyle(closeButton).width).toBe('100%')
    expect(getComputedStyle(closeButton).minHeight).toBe('32px')
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('docks the narrow dialog at the bottom with Figma gutters and a fixed action area', async () => {
    mockMedia({ coarse: true, narrow: true })
    const dependencies = createDependencies()

    render(<ClientNotificationWindow dependencies={dependencies} />)

    const dialog = await screen.findByRole('dialog')
    const closeButton = screen.getByRole('button', { name: 'Got it' })
    const content = dialog.querySelector('.MuiDialogContent-root')
    const titleContainer = dialog.querySelector('.MuiDialogTitle-root')
    const body = screen.getByText('本次更新内容')

    expect(getComputedStyle(dialog).borderRadius).toBe('34px 34px 58px 58px')
    expect(getComputedStyle(dialog).margin).toBe('6px')
    expect(getComputedStyle(dialog.parentElement as HTMLElement).alignItems).toBe('flex-end')
    expect(getComputedStyle(dialog).maxHeight).toBe('var(--notification-mobile-height)')
    expect(getComputedStyle(dialog).getPropertyValue('--notification-mobile-height')).toBe(
      'min(638px, calc(100dvh - 12px - var(--mobile-safe-area-inset-top, env(safe-area-inset-top, 0px))))'
    )
    expect(getComputedStyle(dialog).maxWidth).toBe('418px')
    expect(getComputedStyle(dialog).width).toBe('calc(100% - 12px)')
    expect(getComputedStyle(closeButton).width).toBe('100%')
    expect(getComputedStyle(closeButton).minHeight).toBe('52px')
    expect(getComputedStyle(body.parentElement as HTMLElement).fontSize).toBe('14px')
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(titleContainer).not.toBeNull()
    expect(getComputedStyle(titleContainer as HTMLElement).paddingLeft).toBe('16px')
    expect(getComputedStyle(titleContainer as HTMLElement).paddingBottom).toBe('0px')
    expect(content).not.toBeNull()
    expect(getComputedStyle(content as HTMLElement).padding).toBe('0px')
    expect(content?.contains(closeButton)).toBe(false)
    expect(content?.contains(titleContainer)).toBe(true)
    expect(getComputedStyle(content as HTMLElement).overscrollBehavior).toBe('contain')
  })

  it('tracks and safely opens HTTPS body links while rejecting unsafe content', async () => {
    const safeUrl = 'https://chatboxai.app/help?from=notification'
    const linkedNotification = {
      ...notification,
      body_markdown: [
        `[safe link](${safeUrl})`,
        '[unsafe link](javascript:alert(1))',
        '![release](https://assets.chatboxai.app/notifications/release.png)',
        '![local preview](http://127.0.0.1:8003/notifications/local-qa-preview.png)',
        '![third party](https://example.com/tracker.png)',
        '<script>alert(1)</script>',
      ].join('\n\n'),
    }
    const dependencies = createDependencies({
      getNextNotification: vi.fn().mockResolvedValue(linkedNotification),
    })

    render(<ClientNotificationWindow dependencies={dependencies} />)

    const safeLink = await screen.findByRole('link', { name: 'safe link' })
    expect(screen.queryByRole('link', { name: 'unsafe link' })).toBeNull()
    expect(screen.getByAltText('release')).not.toBeNull()
    expect(screen.getByAltText('local preview')).not.toBeNull()
    expect(screen.queryByAltText('third party')).toBeNull()
    expect(screen.queryByText('alert(1)')).toBeNull()

    fireEvent.click(safeLink)

    expect(dependencies.trackLinkClick).toHaveBeenCalledWith(linkedNotification)
    expect(dependencies.openLink).toHaveBeenCalledWith(safeUrl)
    expect(screen.getByRole('dialog')).not.toBeNull()
  })

  it.each(['backdrop', 'escape', 'back'] as const)(
    'closes via %s without changing display tracking',
    async (method) => {
      let back = () => {}
      const removeBack = vi.fn()
      const dependencies = createDependencies({
        onBackButton: (callback) => {
          back = callback
          return removeBack
        },
      })
      render(<ClientNotificationWindow dependencies={dependencies} />)
      const dialog = await screen.findByRole('dialog')
      await waitFor(() => expect(dependencies.trackImpression).toHaveBeenCalledOnce())
      fireEvent.click(screen.getByText('本次更新内容'))
      expect(screen.getByRole('dialog')).not.toBeNull()
      if (method === 'backdrop') {
        const container = dialog.parentElement
        if (!container) throw new Error('Missing dialog container')
        fireEvent.mouseDown(container)
        fireEvent.click(container)
      } else if (method === 'escape') {
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
      } else {
        back()
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(dependencies.markBatchDisplayed).toHaveBeenCalledOnce()
      expect(dependencies.trackImpression).toHaveBeenCalledOnce()
      expect(removeBack).toHaveBeenCalledOnce()
    }
  )

  it.each([false, true])(
    'sizes the cover and falls back to the bundled image on failure (narrow: %s)',
    async (narrow) => {
      mockMedia({ narrow })
      const cover = 'https://assets.chatboxai.app/notifications/cover.png'
      render(
        <ClientNotificationWindow
          dependencies={createDependencies({
            getNextNotification: vi.fn().mockResolvedValue({ ...notification, cover_image_url: cover }),
          })}
        />
      )
      const dialog = await screen.findByRole('dialog')
      const image = screen.getByAltText('')
      expect(image.getAttribute('src')).toBe(cover)
      expect(getComputedStyle(image).opacity).toBe('0')
      fireEvent.load(image)
      expect(getComputedStyle(image).opacity).toBe('1')
      expect(getComputedStyle(image).objectFit).toBe('cover')
      if (narrow) {
        expect(getComputedStyle(dialog).height).toBe('auto')
        expect(getComputedStyle(dialog).minHeight).toBe('min(320px, var(--notification-mobile-height))')
        expect(getComputedStyle(image).height).toBe('min(96px, calc(var(--notification-mobile-height) * 0.3))')
      } else {
        expect(getComputedStyle(dialog).height).toBe('544px')
      }
      expect(getComputedStyle(image).aspectRatio.replace(/\s/g, '')).toBe('571/132')
      expect(getComputedStyle(image).objectPosition).toBe('center bottom')
      const header = dialog.querySelector('.MuiDialogTitle-root') as HTMLElement
      expect(getComputedStyle(header).paddingTop).toBe(narrow ? '12px' : '8px')
      const scrollContent = dialog.querySelector('.MuiDialogContent-root')
      expect(scrollContent?.contains(image)).toBe(false)
      expect(image.parentElement).toBe(dialog)
      expect(getComputedStyle(image).flexShrink).toBe('0')
      expect(getComputedStyle(dialog).overflow).toBe('hidden')
      expect(scrollContent?.contains(header)).toBe(true)
      expect(scrollContent?.contains(screen.getByText('本次更新内容'))).toBe(true)
      expect(
        image.compareDocumentPosition(screen.getByText(notification.title)) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      fireEvent.error(image)
      expect(dialog.querySelector('img')?.getAttribute('src')).toContain('default-light.png')
      expect(getComputedStyle(dialog).height).toBe(narrow ? 'auto' : '544px')
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
  )

  it.each([undefined, '', 'https://example.com/cover.png', 'javascript:alert(1)'])(
    'uses the bundled cover for unavailable or unsafe cover %s',
    async (cover_image_url) => {
      render(
        <ClientNotificationWindow
          dependencies={createDependencies({
            getNextNotification: vi.fn().mockResolvedValue({ ...notification, cover_image_url }),
          })}
        />
      )
      const dialog = await screen.findByRole('dialog')
      expect(dialog.querySelector('img')?.getAttribute('src')).toContain('default-light.png')
      expect(screen.getByText(notification.body_markdown)).not.toBeNull()
    }
  )

  it.each([undefined, 'https://assets.chatboxai.app/notifications/custom.png'])(
    'follows the application theme without overriding custom cover %s or repeating impressions',
    async (cover_image_url) => {
      const dependencies = createDependencies({
        getNextNotification: vi.fn().mockResolvedValue({ ...notification, cover_image_url }),
      })
      const view = (mode: 'light' | 'dark') => (
        <ThemeProvider theme={createTheme({ palette: { mode } })}>
          <ClientNotificationWindow dependencies={dependencies} />
        </ThemeProvider>
      )
      const { rerender } = render(view('light'))
      const dialog = await screen.findByRole('dialog')
      expect(dialog.querySelector('img')?.getAttribute('src')).toContain(cover_image_url ?? 'default-light.png')
      await waitFor(() => expect(dependencies.trackImpression).toHaveBeenCalledOnce())
      rerender(view('dark'))
      expect(dialog.querySelector('img')?.getAttribute('src')).toContain(cover_image_url ?? 'default-dark.png')
      rerender(view('light'))
      expect(dialog.querySelector('img')?.getAttribute('src')).toContain(cover_image_url ?? 'default-light.png')
      expect(dependencies.getNextNotification).toHaveBeenCalledOnce()
      expect(dependencies.trackImpression).toHaveBeenCalledOnce()
      expect(dependencies.markBatchDisplayed).toHaveBeenCalledOnce()
    }
  )
})
