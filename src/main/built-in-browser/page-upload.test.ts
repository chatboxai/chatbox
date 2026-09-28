import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { handFilesToPage, inspectUploadFiles } from './page-upload'

describe('inspectUploadFiles', () => {
  let root: string
  let work: string
  let outside: string

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'browser-upload-')))
    work = path.join(root, 'work')
    outside = path.join(root, 'outside')
    mkdirSync(path.join(work, 'shots'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(path.join(work, 'shots', 'a.png'), 'png-bytes')
    writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    symlinkSync(path.join(outside, 'secret.txt'), path.join(work, 'link.txt'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('resolves relative paths against the working directory and reports name and size', async () => {
    expect(await inspectUploadFiles({ files: ['shots/a.png'], baseDirectory: work, allowedRoots: [work] })).toEqual({
      files: [{ name: 'a.png', size: 9, path: path.join(work, 'shots', 'a.png') }],
    })
  })

  it('asks for approval for files outside the allowed directories, symlinks included', async () => {
    for (const file of [path.join(outside, 'secret.txt'), 'link.txt']) {
      expect(await inspectUploadFiles({ files: [file], baseDirectory: work, allowedRoots: [work] })).toMatchObject({
        code: 'approval_required',
        files: [{ size: 6 }],
      })
    }
    expect(await inspectUploadFiles({ files: [path.join(outside, 'secret.txt')] })).toMatchObject({
      files: [{ name: 'secret.txt' }],
    })
  })

  it('hands over the file a symlink points to, under its own name and canonical path', async () => {
    expect(await inspectUploadFiles({ files: ['link.txt'], baseDirectory: work })).toEqual({
      files: [{ name: 'secret.txt', size: 6, path: path.join(outside, 'secret.txt') }],
    })
    expect(await inspectUploadFiles({ files: ['link.txt'], baseDirectory: work, allowedRoots: [work] })).toMatchObject({
      code: 'approval_required',
      files: [{ name: 'secret.txt', path: path.join(outside, 'secret.txt') }],
    })
  })

  it('accepts an approval only for the files as they were approved', async () => {
    const file = path.join(outside, 'report.txt')
    writeFileSync(file, 'draft')
    const request = { files: [file], allowedRoots: [work] }
    const pending = await inspectUploadFiles(request)
    const approvedVersion = 'approvalVersion' in pending ? pending.approvalVersion : undefined
    expect(approvedVersion).toEqual(expect.any(String))

    expect(await inspectUploadFiles({ ...request, approvedVersion })).toEqual({
      files: [{ name: 'report.txt', size: 5, path: file }],
    })
    expect(await inspectUploadFiles({ ...request, approvedVersion: 'other' })).toMatchObject({
      code: 'approval_required',
    })
    writeFileSync(file, 'final text')
    expect(await inspectUploadFiles({ ...request, approvedVersion })).toMatchObject({ code: 'approval_required' })

    // A symlink swapped to another file after the approval names another canonical path.
    const link = path.join(work, 'approved.txt')
    symlinkSync(file, link)
    const linked = await inspectUploadFiles({ files: [link], allowedRoots: [work] })
    const linkedVersion = 'approvalVersion' in linked ? linked.approvalVersion : undefined
    rmSync(link)
    symlinkSync(path.join(outside, 'secret.txt'), link)
    expect(
      await inspectUploadFiles({ files: [link], allowedRoots: [work], approvedVersion: linkedVersion })
    ).toMatchObject({ code: 'approval_required', files: [{ path: path.join(outside, 'secret.txt') }] })
  })

  it('never treats a file system root as a directory files may come from without approval', async () => {
    const file = path.join(outside, 'secret.txt')
    expect(await inspectUploadFiles({ files: [file], allowedRoots: [path.parse(file).root] })).toMatchObject({
      code: 'approval_required',
    })
  })

  it('refuses missing files, directories, relative paths without a base and too many files', async () => {
    expect(await inspectUploadFiles({ files: ['missing.png'], baseDirectory: work })).toMatchObject({
      code: 'file_unavailable',
      message: expect.stringContaining('not found'),
    })
    expect(await inspectUploadFiles({ files: ['shots'], baseDirectory: work })).toMatchObject({
      code: 'file_unavailable',
      message: expect.stringContaining('Not a file'),
    })
    expect(await inspectUploadFiles({ files: ['shots/a.png'] })).toMatchObject({ code: 'file_unavailable' })
    expect(await inspectUploadFiles({ files: Array(11).fill('shots/a.png'), baseDirectory: work })).toMatchObject({
      code: 'file_unavailable',
      message: expect.stringContaining('At most 10'),
    })
  })
})

type Handler = (params: Record<string, unknown> | undefined) => unknown

/** Settles with `value`, or rejects once `signal` aborts, as the page debugger does. */
function raceAbort<T>(value: T | Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(value)
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    Promise.resolve(value).then(resolve, reject)
  })
}

/** A page whose CDP commands answer from `handlers`, recording every call. */
function fakePage(handlers: Record<string, Handler>, chooser: unknown = null) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  let clicked = false
  const page = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      calls.push({ method, params })
      if (method === 'Runtime.callFunctionOn' && String(params?.functionDeclaration).includes('this.click()')) {
        clicked = true
      }
      return await raceAbort(handlers[method]?.(params) ?? {}, signal)
    }),
    nextEvent: vi.fn(async (_method: string, _timeoutMs: number, signal: AbortSignal) => {
      // The chooser opens in answer to the click that follows this call.
      await raceAbort(Promise.resolve(), signal)
      return clicked ? chooser : null
    }),
    reset: vi.fn(),
  }
  return { page: page as unknown as Parameters<typeof handFilesToPage>[0], calls, reset: page.reset }
}

const element = { result: { objectId: 'target' } }
const onPage = () => ({ isCurrent: () => true, isSameDocument: () => true, onTouch: vi.fn() })
const noInputInside = (params: Record<string, unknown> | undefined) =>
  String(params?.functionDeclaration).includes('isFileInput') ? { result: { subtype: 'null' } } : {}

describe('handFilesToPage', () => {
  const files = ['/work/a.png']

  it('sets the files on a file input without clicking it', async () => {
    const { page, calls } = fakePage({
      'Runtime.evaluate': () => element,
      'Runtime.callFunctionOn': (params) =>
        String(params?.functionDeclaration).includes('isFileInput')
          ? { result: { objectId: 'input' } }
          : { result: { value: { disabled: false, multiple: false } } },
    })
    const hooks = onPage()

    expect(await handFilesToPage(page, 'input', files, new AbortController().signal, hooks)).toEqual({
      kind: 'handed',
    })
    expect(calls).toContainEqual({ method: 'DOM.setFileInputFiles', params: { objectId: 'input', files } })
    expect(calls.some((call) => call.method === 'Page.setInterceptFileChooserDialog')).toBe(false)
    expect(hooks.onTouch).toHaveBeenCalledOnce()
  })

  it('refuses a disabled or single-file input before touching the page', async () => {
    const describe = (value: Record<string, boolean>) =>
      fakePage({
        'Runtime.evaluate': () => element,
        'Runtime.callFunctionOn': (params) =>
          String(params?.functionDeclaration).includes('isFileInput')
            ? { result: { objectId: 'input' } }
            : { result: { value } },
      }).page
    const hooks = onPage()
    const signal = new AbortController().signal

    expect(await handFilesToPage(describe({ disabled: true }), 'input', files, signal, hooks)).toMatchObject({
      kind: 'refused',
      code: 'target_unsupported',
    })
    expect(await handFilesToPage(describe({ multiple: false }), 'input', ['/a', '/b'], signal, hooks)).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('single file'),
    })
    expect(hooks.onTouch).not.toHaveBeenCalled()
  })

  it('refuses a selector that matches nothing or is invalid', async () => {
    const signal = new AbortController().signal
    const missing = fakePage({ 'Runtime.evaluate': () => ({ result: { subtype: 'null' } }) }).page
    const invalid = fakePage({ 'Runtime.evaluate': () => ({ result: {}, exceptionDetails: {} }) }).page

    expect(await handFilesToPage(missing, '#nope', files, signal, onPage())).toMatchObject({
      kind: 'refused',
      code: 'target_not_found',
    })
    expect(await handFilesToPage(invalid, '[', files, signal, onPage())).toMatchObject({
      message: expect.stringContaining('Invalid selector'),
    })
  })

  it('does not touch a page that moved on while the target was inspected', async () => {
    let checks = 0
    const { page, calls } = fakePage({
      'Runtime.evaluate': () => element,
      'Runtime.callFunctionOn': (params) =>
        String(params?.functionDeclaration).includes('isFileInput')
          ? { result: { objectId: 'input' } }
          : { result: { value: { disabled: false, multiple: false } } },
    })
    // Current when the target is found, gone by the time the files would be handed over.
    const hooks = { isCurrent: () => ++checks === 1, isSameDocument: () => true, onTouch: vi.fn() }

    expect(await handFilesToPage(page, 'input', files, new AbortController().signal, hooks)).toMatchObject({
      kind: 'refused',
      code: 'page_changed',
    })
    expect(hooks.onTouch).not.toHaveBeenCalled()
    expect(calls.some((call) => call.method === 'DOM.setFileInputFiles')).toBe(false)
  })

  it('does not act on a target found after the page moved on', async () => {
    const { page, calls } = fakePage({ 'Runtime.evaluate': () => element })
    const hooks = { isCurrent: () => false, isSameDocument: () => true, onTouch: vi.fn() }

    expect(await handFilesToPage(page, 'input', files, new AbortController().signal, hooks)).toMatchObject({
      kind: 'refused',
      code: 'page_changed',
    })
    expect(calls.map((call) => call.method)).toEqual(['Runtime.evaluate', 'Runtime.releaseObjectGroup'])
    expect(hooks.onTouch).not.toHaveBeenCalled()
  })

  it('clicks another target and hands the files to the picker it opens', async () => {
    const { page, calls } = fakePage(
      {
        'Runtime.evaluate': () => element,
        'Runtime.callFunctionOn': (params) =>
          String(params?.functionDeclaration).includes('ownerDocument')
            ? { result: { value: true } }
            : noInputInside(params),
        'DOM.resolveNode': () => ({ object: { objectId: 'hidden-input' } }),
      },
      { mode: 'selectSingle', backendNodeId: 7 }
    )

    expect(await handFilesToPage(page, 'button', files, new AbortController().signal, onPage())).toEqual({
      kind: 'handed',
    })
    const methods = calls.map((call) => call.method)
    expect(methods.indexOf('Page.setInterceptFileChooserDialog')).toBeLessThan(methods.indexOf('DOM.resolveNode'))
    expect(calls).toContainEqual({ method: 'DOM.setFileInputFiles', params: { objectId: 'hidden-input', files } })
    // Interception ends with the upload, so pickers the user opens later show as usual.
    expect(calls.filter((call) => call.method === 'Page.setInterceptFileChooserDialog').at(-1)?.params).toEqual({
      enabled: false,
    })
  })

  it('hands files to the picker when the click only changed the URL within the document', async () => {
    let clicked = false
    const { page, calls } = fakePage(
      {
        'Runtime.evaluate': () => element,
        'Runtime.callFunctionOn': (params) => {
          if (String(params?.functionDeclaration).includes('this.click()')) clicked = true
          return String(params?.functionDeclaration).includes('ownerDocument')
            ? { result: { value: true } }
            : noInputInside(params)
        },
        'DOM.resolveNode': () => ({ object: { objectId: 'hidden-input' } }),
      },
      { mode: 'selectSingle', backendNodeId: 7 }
    )
    // The click renewed the page reference (a new URL), but the document is the one validated.
    const hooks = { isCurrent: () => !clicked, isSameDocument: () => true, onTouch: vi.fn() }

    expect(await handFilesToPage(page, 'a', files, new AbortController().signal, hooks)).toEqual({ kind: 'handed' })
    expect(calls).toContainEqual({ method: 'DOM.setFileInputFiles', params: { objectId: 'hidden-input', files } })
  })

  it('does not hand files to a picker of another document', async () => {
    const { page, calls } = fakePage(
      {
        'Runtime.evaluate': () => element,
        'Runtime.callFunctionOn': (params) => {
          if (String(params?.functionDeclaration).includes('ownerDocument')) {
            throw new Error('Argument should belong to the same JavaScript world as target object')
          }
          return noInputInside(params)
        },
        'DOM.resolveNode': () => ({ object: { objectId: 'other-input' } }),
      },
      { mode: 'selectSingle', backendNodeId: 7 }
    )

    expect(await handFilesToPage(page, 'button', files, new AbortController().signal, onPage())).toMatchObject({
      kind: 'failed',
      code: 'page_changed',
    })
    expect(calls.some((call) => call.method === 'DOM.setFileInputFiles')).toBe(false)
  })

  it('reports a click the page threw on instead of waiting for a picker', async () => {
    const { page } = fakePage({
      'Runtime.evaluate': () => element,
      'Runtime.callFunctionOn': (params) =>
        String(params?.functionDeclaration).includes('this.click()')
          ? { result: {}, exceptionDetails: { exception: { description: 'TypeError: blocked' } } }
          : { result: { subtype: 'null' } },
    })
    expect(await handFilesToPage(page, 'svg', files, new AbortController().signal, onPage())).toEqual({
      kind: 'failed',
      code: 'target_unsupported',
      message: 'TypeError: blocked',
    })
  })

  it('reports a click that opened no picker as failed', async () => {
    const { page } = fakePage({
      'Runtime.evaluate': () => element,
      'Runtime.callFunctionOn': () => ({ result: { subtype: 'null' } }),
    })
    expect(await handFilesToPage(page, 'button', files, new AbortController().signal, onPage())).toMatchObject({
      kind: 'failed',
      code: 'no_file_chooser',
    })
  })

  it('ends a click cancelled mid-way cleanly and restores the file picker', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const abort = new AbortController()
    const { page, calls } = fakePage({
      'Runtime.evaluate': () => element,
      'Runtime.callFunctionOn': (params) =>
        String(params?.functionDeclaration).includes('this.click()') ? new Promise(() => {}) : noInputInside(params),
    })
    page.nextEvent = vi.fn((_method: string, _timeoutMs: number, signal: AbortSignal) =>
      raceAbort(new Promise<null>(() => {}), signal)
    )

    const handed = handFilesToPage(page, 'button', files, abort.signal, {
      isCurrent: () => true,
      isSameDocument: () => true,
      onTouch: () => abort.abort(new Error('cancelled')),
    })
    await expect(handed).rejects.toThrow('cancelled')
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.method === 'Page.setInterceptFileChooserDialog').at(-1)?.params).toEqual({
      enabled: false,
    })
  })

  it('restores the file picker when cancelled while interception is being enabled', async () => {
    const abort = new AbortController()
    const { page, calls } = fakePage({
      'Runtime.evaluate': () => element,
      'Runtime.callFunctionOn': noInputInside,
      'Page.setInterceptFileChooserDialog': (params) => {
        if (params?.enabled) abort.abort(new Error('cancelled'))
        return {}
      },
    })

    await expect(handFilesToPage(page, 'button', files, abort.signal, onPage())).rejects.toThrow('cancelled')
    expect(
      calls.filter((call) => call.method === 'Page.setInterceptFileChooserDialog').map((call) => call.params)
    ).toEqual([{ enabled: true }, { enabled: false }])
  })

  it('ends the debugger session when the page does not answer the restore', async () => {
    const abort = new AbortController()
    const { page, reset } = fakePage({
      'Runtime.evaluate': () => element,
      'Runtime.callFunctionOn': noInputInside,
      'Page.setInterceptFileChooserDialog': (params) => {
        if (!params?.enabled) return new Promise(() => {})
        abort.abort(new Error('timed out'))
        return {}
      },
    })

    await expect(handFilesToPage(page, 'button', files, abort.signal, onPage())).rejects.toThrow('timed out')
    expect(reset).toHaveBeenCalledOnce()
  })
})
