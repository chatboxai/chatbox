import { BUILT_IN_BROWSER_MAX_TABS, type BuiltInBrowserCall } from '@shared/built-in-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageOutcomeTarget } from './page-outcomes'

interface FakeController {
  tab: string
  url: string
  target: PageOutcomeTarget
  request: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  endLingeringCapture: ReturnType<typeof vi.fn>
  setView: ReturnType<typeof vi.fn>
  getState: () => { url: string; title: string }
}

const controllers = vi.hoisted(() => [] as FakeController[])

vi.mock('./controller', () => ({
  BuiltInBrowserController: class {
    url = ''
    tab: string
    cancel = vi.fn()
    dispose = vi.fn()
    endLingeringCapture = vi.fn()
    setView = vi.fn(() => Promise.resolve(null))
    request = vi.fn((_host: unknown, _owner: number, call: BuiltInBrowserCall): Promise<Record<string, unknown>> => {
      if ('url' in call && call.url?.includes('unreachable')) return Promise.reject(new Error('Load failed'))
      if ('url' in call && call.url) this.url = call.url
      // Like a page, the result hands out what the shared queue holds.
      const events = this.target.outcomes.take()
      if (call.kind === 'run') {
        return Promise.resolve({ page: call.page, url: this.url, title: '', run: { status: 'completed' }, ...events })
      }
      return Promise.resolve({
        page: `${this.tab}.ref`,
        url: this.url,
        title: `Title ${this.url}`,
        content: '',
        ...events,
      })
    })
    getState = () => ({ url: this.url, title: `Title ${this.url}` })
    constructor(
      _sessionId: string,
      _manage: boolean,
      _onState: () => void,
      public target: PageOutcomeTarget
    ) {
      this.tab = target.tab ?? ''
      controllers.push(this as unknown as FakeController)
    }
  },
}))

const { SessionPages } = await import('./session-pages')

const host = {} as Parameters<InstanceType<typeof SessionPages>['request']>[0]
const bounds = { x: 0, y: 0, width: 400, height: 600 }

function pagesFor(owner = { send: vi.fn(), isDestroyed: () => false }) {
  return new SessionPages('conversation', owner as never)
}

let requestCount = 0

function read(
  pages: InstanceType<typeof SessionPages>,
  request: Omit<Extract<BuiltInBrowserCall, { kind: 'read' }>, 'kind' | 'requestId'>
) {
  return pages.request(host, 1, { kind: 'read', requestId: `r${++requestCount}`, ...request })
}

describe('SessionPages routing', () => {
  beforeEach(() => {
    controllers.length = 0
  })

  it('opens the model its own tab for a url and keeps working there', async () => {
    const pages = pagesFor()
    expect(await read(pages, { url: 'https://a.example/' })).toMatchObject({ tab: 't1', page: 't1.ref' })
    expect(await read(pages, { url: 'https://b.example/' })).toMatchObject({ tab: 't1' })
    expect(await read(pages, {})).toMatchObject({ tab: 't1', url: 'https://b.example/' })
    expect(controllers).toHaveLength(1)
  })

  it('opens a new tab beside the model tab and lists the open tabs', async () => {
    const pages = pagesFor()
    await read(pages, { url: 'https://a.example/' })
    const second = await read(pages, { url: 'https://b.example/', newTab: true })
    expect(second).toMatchObject({
      tab: 't2',
      tabs: [
        { tab: 't1', url: 'https://a.example/' },
        { tab: 't2', url: 'https://b.example/' },
      ],
    })
    // The newest tab opened for the model is its own; `tab` returns to another.
    expect(await read(pages, {})).toMatchObject({ tab: 't2' })
    expect(await read(pages, { tab: 't1' })).toMatchObject({ tab: 't1', url: 'https://a.example/' })
    expect(controllers[0].request.mock.calls.at(-1)?.[2]).not.toHaveProperty('tab')
  })

  it('never loads a url into a tab the user opened unless the model names it', async () => {
    const pages = pagesFor()
    const userTab = pages.openTab()
    await pages.setView(host, userTab, { visible: true, bounds })
    // Without a tab of its own, the model reads the page the user is looking at.
    expect(await read(pages, {})).toMatchObject({ tab: userTab })
    expect(await read(pages, { url: 'https://model.example/' })).toMatchObject({ tab: 't2' })
    expect(controllers[0].request.mock.calls.some(([, , call]) => 'url' in call && call.url)).toBe(false)
    expect(await read(pages, { tab: userTab, url: 'https://named.example/' })).toMatchObject({ tab: userTab })
  })

  it('opens another tab for a url once the model tab closed', async () => {
    const pages = pagesFor()
    pages.openTab()
    await read(pages, { url: 'https://model.example/' })
    pages.closeTab('t2')
    expect(await read(pages, { url: 'https://next.example/' })).toMatchObject({ tab: 't3' })
    expect(await read(pages, {})).toMatchObject({ tab: 't3' })
  })

  it('keeps a tab whose first page failed as the model tab', async () => {
    const pages = pagesFor()
    await expect(read(pages, { url: 'https://unreachable.example/', newTab: true })).rejects.toThrow('Load failed')
    expect(pages.list().tabs.map((tab) => tab.id)).toEqual(['t1'])
    expect(await read(pages, { url: 'https://next.example/' })).toMatchObject({ tab: 't1' })
  })

  it('reads the viewed tab while a menu covers it, and the first tab when none is viewed', async () => {
    const pages = pagesFor()
    pages.openTab()
    pages.openTab()
    await pages.setView(host, 't2', { visible: true, bounds })
    await pages.setView(host, 't2', { visible: false, snapshot: true })
    expect(await read(pages, {})).toMatchObject({ tab: 't2', tabs: [{ tab: 't1' }, { tab: 't2', viewing: true }] })
    await pages.setView(host, 't2', { visible: false })
    expect(await read(pages, {})).toMatchObject({ tab: 't1' })
  })

  it('refuses unknown tabs, a new tab without a url, a read with no page and tabs beyond the limit', async () => {
    const pages = pagesFor()
    await expect(read(pages, {})).rejects.toThrow('pass a url')
    expect(controllers).toHaveLength(0)
    await expect(read(pages, { tab: 't7' })).rejects.toThrow('No tab t7')
    await expect(read(pages, { newTab: true })).rejects.toThrow('Pass the url')
    for (let index = 0; index < BUILT_IN_BROWSER_MAX_TABS; index++) pages.openTab()
    await expect(read(pages, { url: 'https://c.example/', newTab: true })).rejects.toThrow(
      `already has ${BUILT_IN_BROWSER_MAX_TABS} tabs open`
    )
  })
})

describe('SessionPages references', () => {
  beforeEach(() => {
    controllers.length = 0
  })

  it('runs a script on the tab its page reference came from, and names that tab when the page refuses it', async () => {
    const pages = pagesFor()
    const first = await read(pages, { url: 'https://a.example/' })
    await read(pages, { url: 'https://b.example/', newTab: true })
    const run = await pages.request(host, 1, { kind: 'run', requestId: 'run', page: String(first.page), code: '1' })
    expect(controllers[0].request).toHaveBeenLastCalledWith(host, 1, expect.objectContaining({ page: 't1.ref' }))
    expect(run).toMatchObject({ tab: 't1' })
    controllers[0].request.mockResolvedValueOnce({
      url: 'https://a.example/',
      title: '',
      run: { operationId: 'op', status: 'not_started', code: 'page_changed', message: 'The page changed.' },
    })
    const refused = await pages.request(host, 1, { kind: 'run', requestId: 'again', page: 't1.old', code: '1' })
    expect(refused.run).toMatchObject({ message: 'The page changed. Pass tab t1 to read this page again.' })
    controllers[0].request.mockResolvedValueOnce({
      url: 'https://a.example/',
      title: '',
      run: { operationId: 'op', status: 'not_started', code: 'syntax_error', message: 'Unexpected token.' },
    })
    const invalid = await pages.request(host, 1, { kind: 'run', requestId: 'fix', page: 't1.ref', code: '(' })
    expect(invalid.run).toMatchObject({ message: 'Unexpected token.' })
  })

  it('continues a cursor on its own page whatever url or tab comes with it', async () => {
    const pages = pagesFor()
    await read(pages, { url: 'https://a.example/' })
    await read(pages, { url: 'https://b.example/', newTab: true })
    await pages.request(host, 1, {
      kind: 'snapshot',
      requestId: 's1',
      cursor: 't1.ref~v@3',
      url: 'https://c.example/',
      tab: 't2',
    })
    const call = controllers[0].request.mock.calls.at(-1)?.[2]
    expect(call).toMatchObject({ kind: 'snapshot', cursor: 't1.ref~v@3' })
    expect(call).not.toHaveProperty('url')
    expect(controllers).toHaveLength(2)
  })

  it('refuses references of closed tabs and references not from a result, touching no tab', async () => {
    const pages = pagesFor()
    const first = await read(pages, { url: 'https://a.example/' })
    await read(pages, { url: 'https://b.example/', newTab: true })
    pages.closeTab('t1')
    const run = await pages.request(host, 1, { kind: 'run', requestId: 'run', page: String(first.page), code: '1' })
    expect(run).toMatchObject({ run: { status: 'not_started', code: 'no_page' }, tabs: [{ tab: 't2' }] })
    const cursor = await pages.request(host, 1, { kind: 'snapshot', requestId: 's', cursor: 't1.ref~v@3' })
    expect(cursor.snapshot).toMatchObject({ error: expect.stringContaining('Tab t1 was closed') })
    const bogus = await pages.request(host, 1, { kind: 'run', requestId: 'bogus', page: 'stale-1', code: '1' })
    expect(bogus.run).toMatchObject({ status: 'not_started', code: 'page_changed' })
    const url = await pages.request(host, 1, {
      kind: 'run',
      requestId: 'url',
      page: 'https://www.example.com',
      code: '1',
    })
    expect(url.run).toMatchObject({ status: 'not_started', code: 'page_changed' })
    expect(controllers[1].request).toHaveBeenCalledTimes(1)
  })
})

describe('SessionPages lifecycle', () => {
  beforeEach(() => {
    controllers.length = 0
  })

  it('shares one outcome queue, so outcomes of a closed tab reach the next result', async () => {
    const pages = pagesFor()
    await read(pages, { url: 'https://a.example/' })
    await read(pages, { url: 'https://b.example/', newTab: true })
    const { outcomes } = controllers[1].target
    expect(controllers[0].target.outcomes).toBe(outcomes)
    pages.closeTab('t2')
    // A download of the closed tab that ends later still lands in the shared queue.
    outcomes.addDownload({ name: 'report.csv', status: 'saved', url: 'https://b.example/report.csv', tab: 't2' })
    expect(await read(pages, {})).toMatchObject({ downloads: [{ name: 'report.csv', tab: 't2' }] })
    expect(await read(pages, {})).not.toHaveProperty('downloads')
  })

  it("ends every tab's lingering download capture when the model makes any browser call", async () => {
    const pages = pagesFor()
    await read(pages, { url: 'https://a.example/' })
    await read(pages, { url: 'https://b.example/', newTab: true })
    controllers[0].endLingeringCapture.mockClear()
    await read(pages, {})
    expect(controllers[0].endLingeringCapture).toHaveBeenCalledOnce()
  })

  it('hands waiting outcomes to a refusal, which reaches the model', async () => {
    const pages = pagesFor()
    await read(pages, { url: 'https://a.example/' })
    controllers[0].target.outcomes.addSettled({ operationId: 'op', status: 'completed', tab: 't1' })
    const refused = await pages.request(host, 1, { kind: 'run', requestId: 'run', page: 't9.ref', code: '1' })
    expect(refused).toMatchObject({ run: { code: 'no_page' }, settledOperations: [{ operationId: 'op' }] })
  })

  it('lists the open tabs when a named tab is not open', async () => {
    const pages = pagesFor()
    await read(pages, { url: 'https://a.example/' })
    await expect(read(pages, { tab: 't4' })).rejects.toThrow('Open tabs: t1 https://a.example/.')
  })

  it('ignores placing a tab that has just closed and pushes every change of the tab list', async () => {
    const owner = { send: vi.fn(), isDestroyed: () => false }
    const pages = pagesFor(owner)
    pages.openTab()
    pages.openTab()
    pages.closeTab('t1')
    expect(owner.send).toHaveBeenLastCalledWith(
      'built-in-browser:tabs',
      expect.objectContaining({ tabs: [expect.objectContaining({ id: 't2' })] })
    )
    await expect(pages.setView(host, 't1', { visible: true, bounds })).resolves.toBeNull()
    pages.cancel(1, 'r')
    expect(controllers[1].cancel).toHaveBeenCalledWith(1, 'r')
    pages.closeAll()
    expect(controllers[1].dispose).toHaveBeenCalledOnce()
    expect(pages.list().tabs).toEqual([])
  })
})
