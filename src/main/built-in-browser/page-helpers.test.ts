// @vitest-environment jsdom

import { BUILT_IN_BROWSER_SCRIPT_HELPERS } from '@shared/built-in-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_HELPERS_SOURCE } from './page-helpers'

interface Helpers {
  elements(options?: { limit?: number; within?: string }): {
    total: number
    items: Array<Record<string, unknown> & { selector: string; text: string }>
  }
  click(target: string | Element): string
  fill(target: string | Element, text: string): string
  press(key: string, target?: string | Element): void
  scroll(pixels?: number, within?: string): { top: number; height: number; viewport: number; atEnd: boolean }
  waitFor(target: string | (() => unknown), timeoutMs?: number): Promise<unknown>
  selector(target: string | Element): string
}

// Chromium provides these; jsdom does not.
if (!globalThis.CSS?.escape) {
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^\w-]/g, (char) => `\\${char}`) })
}
if (!globalThis.PointerEvent) {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {})
}

function loadHelpers(): Helpers {
  return new Function(`${PAGE_HELPERS_SOURCE}\nreturn browser`)() as Helpers
}

/** jsdom has no layout; give every element a box so it counts as visible. */
function layOut(height = 20) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: 100,
    width: 100,
    height,
    toJSON: () => ({}),
  })
}

describe('built-in browser page helpers', () => {
  let browser: Helpers

  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    Element.prototype.scrollIntoView = vi.fn()
    layOut()
    browser = loadHelpers()
  })

  it('defines exactly the helpers the skill documents', () => {
    expect(Object.keys(browser).sort()).toEqual([...BUILT_IN_BROWSER_SCRIPT_HELPERS].sort())
  })

  it('lists visible interactive elements with unique selectors', () => {
    document.body.innerHTML = `
      <nav><a href="/a">First</a><a href="/b">Second</a></nav>
      <footer><a href="/c" style="visibility:hidden">Hidden</a></footer>
      <input name="q" placeholder="Search" value="old">
      <input type="password" id="pw" value="secret">
      <button data-testid="go" disabled>Go</button>
      <button style="display:none">Hidden</button>`
    const { total, items } = browser.elements()

    expect(total).toBe(5)
    expect(items.map((item) => item.selector)).toEqual([
      'nav > a:nth-of-type(1)',
      'a:nth-of-type(2)',
      'input[name="q"]',
      '#pw',
      'button[data-testid="go"]',
    ])
    expect(items[2]).toMatchObject({ tag: 'input', type: 'text', value: 'old', text: 'Search' })
    expect(items[3]).not.toHaveProperty('value')
    expect(items[4]).toMatchObject({ disabled: true, text: 'Go' })
    for (const item of items) expect(document.querySelectorAll(item.selector)).toHaveLength(1)
    expect(browser.elements({ limit: 1, within: 'nav' })).toMatchObject({ total: 2, items: [{ text: 'First' }] })
  })

  it('clicks with the pointer and mouse sequence a real click produces', () => {
    document.body.innerHTML = '<button aria-label="Open menu">≡</button>'
    const button = document.querySelector('button') as HTMLButtonElement
    const seen: string[] = []
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      button.addEventListener(type, (event) => seen.push(`${type}:${event.bubbles}`))
    }

    expect(browser.click('button')).toBe('Open menu')
    expect(seen).toEqual(['pointerdown:true', 'mousedown:true', 'pointerup:true', 'mouseup:true', 'click:true'])
    expect(document.activeElement).toBe(button)
    expect(() => browser.click('.missing')).toThrow('No element matches .missing')
  })

  it('fills fields through the native value setter so framework listeners see the change', () => {
    document.body.innerHTML = `
      <input name="q"><textarea></textarea>
      <select><option value="1">One</option><option value="2">Two</option></select>`
    const input = document.querySelector('input') as HTMLInputElement
    // Frameworks such as React shadow `value` on the instance; the prototype setter still updates the field.
    let shadowed = ''
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => shadowed,
      set: (value: string) => {
        shadowed = `instance:${value}`
      },
    })
    const inputs: string[] = []
    input.addEventListener('input', () => inputs.push('input'))
    input.addEventListener('change', () => inputs.push('change'))

    browser.fill(input, 'electron')
    expect(shadowed).toBe('')
    expect(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get?.call(input)).toBe('electron')
    expect(inputs).toEqual(['input', 'change'])
    expect(browser.fill('textarea', 'notes')).toBe('notes')
    expect(browser.fill('select', 'Two')).toBe('2')
    expect(() => browser.fill('select', 'Three')).toThrow('No option Three')
  })

  it('presses keys on the focused element and submits a form on Enter', () => {
    document.body.innerHTML = '<form><input name="q"></form>'
    const form = document.querySelector('form') as HTMLFormElement
    const input = document.querySelector('input') as HTMLInputElement
    const submit = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', submit)
    const keys: string[] = []
    input.addEventListener('keydown', (event) => keys.push(event.key))
    input.focus()

    browser.press('a')
    expect(keys).toEqual(['a'])
    expect(submit).not.toHaveBeenCalled()
    browser.press('Enter')
    expect(submit).toHaveBeenCalledTimes(1)

    input.addEventListener('keydown', (event) => event.preventDefault())
    browser.press('Enter', 'input')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('does not submit when the page cancels Enter in keypress', () => {
    document.body.innerHTML = '<form><input name="q"></form>'
    const form = document.querySelector('form') as HTMLFormElement
    const input = document.querySelector('input') as HTMLInputElement
    const submit = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', submit)
    input.addEventListener('keypress', (event) => event.preventDefault())

    browser.press('Enter', input)

    expect(submit).not.toHaveBeenCalled()
  })

  it('notifies editors when a contenteditable value is written without execCommand', () => {
    document.body.innerHTML = '<div contenteditable="true">old</div>'
    const editor = document.querySelector('div') as HTMLDivElement
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    document.execCommand = vi.fn(() => false)
    const inputs = vi.fn()
    editor.addEventListener('input', inputs)

    browser.fill(editor, 'new text')

    expect(editor.textContent).toBe('new text')
    expect(inputs).toHaveBeenCalledTimes(1)
  })

  it('scrolls the largest scrollable panel when the page itself does not scroll', () => {
    document.body.innerHTML = '<div id="feed" style="overflow-y: auto"></div>'
    const feed = document.getElementById('feed') as HTMLDivElement
    Object.defineProperties(feed, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    feed.scrollBy = vi.fn(({ top }: ScrollToOptions) => {
      feed.scrollTop += top ?? 0
    }) as typeof feed.scrollBy

    expect(browser.scroll()).toEqual({ top: 320, height: 1000, viewport: 400, atEnd: false })
    expect(browser.scroll(400, '#feed')).toMatchObject({ top: 720, atEnd: true })
  })

  it('waits for an element or a condition and times out otherwise', async () => {
    setTimeout(() => {
      document.body.innerHTML = '<ul role="listbox"></ul>'
    }, 150)
    const found = await browser.waitFor('[role="listbox"]', 1000)
    expect(found).toBe(document.querySelector('[role="listbox"]'))
    await expect(browser.waitFor(() => document.title === 'never', 150)).rejects.toThrow(
      'Timed out after 150ms waiting for the condition'
    )
  })
})
