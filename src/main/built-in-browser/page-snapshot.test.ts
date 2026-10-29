// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageHelpersSource } from './page-helpers'
import { type PageSnapshotOptions, type PageSnapshotOutcome, pageOfLines, pageSnapshotSource } from './page-snapshot'

// Chromium provides this; jsdom does not.
if (!globalThis.PointerEvent) vi.stubGlobal('PointerEvent', class extends MouseEvent {})
if (!globalThis.CSS?.escape) {
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^\w-]/g, (char) => `\\${char}`) })
}

function snapshot(options: PageSnapshotOptions = {}): PageSnapshotOutcome {
  return new Function(`return ${pageSnapshotSource(options)}`)() as PageSnapshotOutcome
}

function helpers(): {
  selector(target: string): string
  elements(options?: { within?: string }): {
    total: number
    items: Array<{ ref: string; selector?: string; text: string }>
  }
  click(target: string): string
  fill(target: string, text: string): string
  press(key: string, target?: string): void
  scroll(pixels?: number, within?: string): { top: number; atEnd: boolean }
  waitFor(target: string, timeoutMs?: number): Promise<unknown>
} {
  return new Function('operation', `${pageHelpersSource('operation')}\nreturn browser`)({ cancelled: false })
}

describe('page snapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    // Each test starts with a fresh document registry.
    delete (window as unknown as Record<symbol, unknown>)[Symbol.for('chatbox.browser.refs')]
  })

  it('outlines landmarks, headings, lists and controls with references, names and states', () => {
    document.body.innerHTML = `
      <nav aria-label="Primary"><a href="/pulls?q=is%3Aopen">Pull requests</a></nav>
      <main>
        <h2>Open</h2>
        <ul>
          <li><a href="/o/r/pull/12">Fix login bug</a> #12 opened by alice</li>
        </ul>
        <label for="title">Title</label><input id="title" value="Draft">
        <input type="password" aria-label="Secret" value="hunter2">
        <input type="checkbox" aria-label="Draft PR" checked>
        <select aria-label="Reviewer"><option>bob</option><option selected>carol</option></select>
        <button aria-expanded="false" disabled>Create pull request</button>
        <input type="file" id="attach">
        <div hidden><button>Hidden action</button></div>
        <div style="display:none"><a href="/gone">Gone</a></div>
      </main>`

    expect(snapshot().lines).toEqual([
      '- navigation "Primary" [e1]',
      '  - link "Pull requests" [e2] url=/pulls?q=is%3Aopen',
      '- main [e3]',
      '  - heading "Open" level=2',
      '  - list [e4]',
      '    - listitem: #12 opened by alice',
      '      - link "Fix login bug" [e5] url=/o/r/pull/12',
      '  - textbox "Title" [e6] value="Draft"',
      '  - textbox "Secret" [e7]',
      '  - checkbox "Draft PR" [e8] checked',
      '  - combobox "Reviewer" [e9] value="carol"',
      '  - button "Create pull request" [e10] collapsed disabled',
      '  - button "Choose file" [e11] file',
    ])
  })

  it('keeps references of unchanged elements across snapshots and resolves them in helpers', async () => {
    document.body.innerHTML = '<button id="a">A</button>'
    expect(snapshot().lines).toEqual(['- button "A" [e1]'])
    document.body.insertAdjacentHTML('afterbegin', '<button id="b">B</button>')
    expect(snapshot().lines).toEqual(['- button "B" [e2]', '- button "A" [e1]'])

    let clicked = ''
    document.querySelector('#a')?.addEventListener('click', () => {
      clicked = 'a'
    })
    Element.prototype.scrollIntoView = () => undefined
    helpers().click('e1')
    expect(clicked).toBe('a')

    document.querySelector('#a')?.remove()
    expect(() => helpers().click('e1')).toThrow('Reference e1 is not on the page anymore')
  })

  it('outlines the fields of a same-origin frame and fills them in that frame', () => {
    document.body.innerHTML = '<iframe title="Editor"></iframe>'
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    const frameDocument = frame.contentDocument as Document
    frameDocument.body.innerHTML = '<input aria-label="Name">'
    Object.defineProperty(frameDocument.defaultView?.HTMLElement.prototype, 'scrollIntoView', {
      value: () => undefined,
    })

    expect(snapshot().lines).toEqual(['- iframe "Editor" [e1]', '  - textbox "Name" [e2]'])
    expect(helpers().fill('e2', 'Ada')).toBe('Ada')
    expect((frameDocument.querySelector('input') as HTMLInputElement).value).toBe('Ada')

    // A key pressed without a target goes to the frame field that has focus.
    const pressed: string[] = []
    frameDocument
      .querySelector('input')
      ?.addEventListener('keydown', (event) => pressed.push((event as KeyboardEvent).key))
    ;(frameDocument.querySelector('input') as HTMLInputElement).focus()
    frame.focus()
    helpers().press('Enter')
    expect(pressed).toEqual(['Enter'])

    // Once the frame is gone, its old document has no window and its references are stale.
    frame.remove()
    expect(() => helpers().fill('e2', 'Bob')).toThrow('Reference e2 is not on the page anymore')
  })

  it('gives elements of a frame no page selector, since one would match the page instead', () => {
    document.body.innerHTML = '<button id="save">Page save</button><iframe title="Editor"></iframe>'
    const frameDocument = (document.querySelector('iframe') as HTMLIFrameElement).contentDocument as Document
    frameDocument.body.innerHTML = '<button id="save">Frame save</button>'
    const ref =
      snapshot()
        .lines.find((line) => line.includes('Frame save'))
        ?.match(/\[(e\d+)\]/)?.[1] ?? ''

    expect(() => helpers().selector(ref)).toThrow('use its snapshot reference')
    expect(helpers().elements({ within: ref }).items).toEqual([])
    expect(helpers().selector('#save')).toBe('#save')
  })

  it('outlines links and nested items inside headings and tree items', () => {
    document.body.innerHTML = `
      <h2><a href="/report">Report</a></h2>
      <ul role="tree"><li role="treeitem" aria-label="Docs"><ul role="group"><li role="treeitem">Guide</li></ul></li></ul>`
    expect(snapshot().lines).toEqual([
      '- heading "Report" level=2',
      '  - link "Report" [e1] url=/report',
      '- tree [e2]',
      '  - treeitem "Docs" [e3]',
      '    - group [e4]',
      '      - treeitem "Guide" [e5]',
    ])
  })

  it('shows the chosen options of a native select rendered as a listbox', () => {
    document.body.innerHTML =
      '<select multiple aria-label="Labels"><option selected>bug</option><option>docs</option><option selected>ui</option></select>'
    expect(snapshot().lines).toEqual(['- listbox "Labels" [e1] value="bug, ui"'])
  })

  it('names icon controls by their image', () => {
    document.body.innerHTML = `
      <button><img alt="Search" src="search.png"></button>
      <a href="/settings"><svg aria-label="Settings"></svg></a>
      <button><svg><title>Close</title></svg></button>`
    expect(snapshot().lines).toEqual([
      '- button "Search" [e1]',
      '- link "Settings" [e2] url=/settings',
      '- button "Close" [e3]',
    ])
    expect(snapshot({ query: 'search' }).lines).toEqual(['- button "Search" [e1]'])
  })

  it('gives ARIA headings their level, or level 2 without one', () => {
    document.body.innerHTML = '<div role="heading">Plain</div><div role="heading" aria-level="4">Four</div>'
    expect(snapshot().lines).toEqual(['- heading "Plain" level=2', '- heading "Four" level=4'])
  })

  it('reports why a frame field cannot be filled instead of asking for a selector', () => {
    document.body.innerHTML = '<iframe title="Editor"></iframe>'
    const frameDocument = (document.querySelector('iframe') as HTMLIFrameElement).contentDocument as Document
    frameDocument.body.innerHTML = '<select aria-label="Size"><option>S</option></select>'
    Object.defineProperty(frameDocument.defaultView?.HTMLElement.prototype, 'scrollIntoView', {
      value: () => undefined,
    })
    const ref =
      snapshot()
        .lines.find((line) => line.includes('Size'))
        ?.match(/\[(e\d+)\]/)?.[1] ?? ''

    expect(() => helpers().fill(ref, 'XL')).toThrow(`No option XL in <select> ${ref}`)
  })

  it('stops waiting at once for a reference whose element left the page', async () => {
    document.body.innerHTML = '<button>Gone</button>'
    snapshot()
    document.querySelector('button')?.remove()
    await expect(helpers().waitFor('e1', 3000)).rejects.toThrow('Reference e1 is not on the page anymore')
  })

  it('lists icon buttons drawn in SVG but no plain pictures', () => {
    document.body.innerHTML = `
      <svg role="button" aria-label="Attach"><path d="M0 0"></path></svg>
      <svg aria-hidden="false"><title>Logo</title><circle r="4"></circle></svg>`
    expect(snapshot().lines).toEqual(['- button "Attach" [e1]'])
  })

  it('lists the controls of a frame from the frame reference', () => {
    document.body.innerHTML = '<iframe title="Editor"></iframe>'
    const frameDocument = (document.querySelector('iframe') as HTMLIFrameElement).contentDocument as Document
    frameDocument.body.innerHTML = '<button>Save</button>'
    // jsdom has no layout; the frame's elements come from the frame's own realm.
    const box = { x: 0, y: 0, top: 0, left: 0, bottom: 20, right: 100, width: 100, height: 20, toJSON: () => ({}) }
    const frameElement = (frameDocument.defaultView as unknown as { Element: typeof Element }).Element
    const spies = [
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box),
      vi.spyOn(frameElement.prototype, 'getBoundingClientRect').mockReturnValue(box),
    ]
    try {
      const frameRef = snapshot().lines[0].match(/\[(e\d+)\]/)?.[1] ?? ''
      expect(helpers().elements({ within: frameRef })).toMatchObject({ total: 1, items: [{ text: 'Save' }] })
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('scrolls the document a frame shows from the frame reference', () => {
    document.body.innerHTML = '<iframe title="Feed"></iframe>'
    const frameDocument = (document.querySelector('iframe') as HTMLIFrameElement).contentDocument as Document
    frameDocument.body.innerHTML = '<button>Item</button>'
    const frameRoot = frameDocument.scrollingElement ?? frameDocument.documentElement
    const scrollBy = vi.fn()
    Object.defineProperty(frameRoot, 'scrollBy', { configurable: true, value: scrollBy })
    const frameRef = snapshot().lines[0].match(/\[(e\d+)\]/)?.[1] ?? ''

    helpers().scroll(300, frameRef)
    expect(scrollBy).toHaveBeenCalledWith({ top: 300, behavior: 'instant' })
  })

  it('keeps the controls of a display: contents wrapper, which has no box of its own', () => {
    document.body.innerHTML = '<div style="display: contents"><button>Save</button></div>'
    // Chromium reports no visibility for an element without a box.
    Object.defineProperty(Element.prototype, 'checkVisibility', {
      configurable: true,
      value(this: Element) {
        return getComputedStyle(this).display !== 'contents'
      },
    })
    try {
      expect(snapshot().lines).toEqual(['- button "Save" [e1]'])
    } finally {
      delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility
    }
  })

  it('outlines a script dialog with the page, including a list it opened outside itself', () => {
    document.body.innerHTML = `
      <main aria-hidden="true"><button>Behind</button></main>
      <div role="dialog" aria-modal="true" aria-label="Edit label">
        <p>Pick a color.</p><button role="combobox" aria-expanded="true">Color</button>
      </div>
      <div role="listbox" aria-label="Colors"><div role="option">Red</div></div>`
    expect(snapshot()).toEqual({
      lines: [
        '- dialog "Edit label" [e1]: Pick a color.',
        '  - combobox [e2] expanded value="Color"',
        '- listbox "Colors" [e3]',
        '  - option "Red" [e4]',
      ],
    })
  })

  it('narrows to a scope or to lines matching a query with their containers', () => {
    document.body.innerHTML = `
      <ul><li><a href="/1">Fix login</a></li><li><a href="/2">Add search</a></li></ul>
      <form aria-label="Filters"><input aria-label="Author"></form>`
    snapshot()
    expect(snapshot({ query: 'SEARCH' }).lines).toEqual([
      '- list [e1]',
      '  - listitem',
      '    - link "Add search" [e3] url=/2',
    ])
    const form = snapshot().lines.find((line) => line.includes('form'))
    expect(form).toMatch(/^- form "Filters" \[e\d+\]$/)
    const author = snapshot().lines.find((line) => line.includes('Author'))
    const ref = author?.match(/\[(e\d+)\]/)?.[1] ?? ''
    expect(snapshot({ scope: ref }).lines).toEqual([`- textbox "Author" [${ref}]`])
    expect(snapshot({ scope: 'e99' })).toMatchObject({ error: expect.stringContaining('e99') })
  })

  it('scopes to a container by its reference', () => {
    document.body.innerHTML = `
      <main><section aria-label="Settings"><button>Save</button></section><button>Elsewhere</button></main>`
    const settings = snapshot().lines.find((line) => line.includes('region "Settings"'))
    const ref = settings?.match(/\[(e\d+)\]/)?.[1] ?? ''
    expect(snapshot({ scope: ref }).lines).toEqual([
      `- region "Settings" [${ref}]`,
      expect.stringContaining('- button "Save"'),
    ])
  })

  it('finds query matches beyond the lines one snapshot returns', () => {
    const rows = Array.from({ length: 1600 }, (_, index) => `<li><button>Row ${index}</button></li>`).join('')
    document.body.innerHTML = `<ul>${rows}</ul><button>Export all</button>`

    expect(snapshot()).toMatchObject({ truncated: true })
    expect(snapshot().lines).toHaveLength(3000)
    expect(snapshot({ query: 'Export all' }).lines).toEqual([expect.stringMatching(/^- button "Export all" \[e\d+\]$/)])
  })
})

describe('pageOfLines', () => {
  const lines = ['- a', '- b', '- c', '- d']

  it('returns the lines that fit and a cursor for the rest of the same page', () => {
    const first = pageOfLines(lines, { page: 'p-1', maxChars: 8 })
    expect(first).toEqual({
      content: '- a\n- b',
      nextCursor: expect.stringMatching(/^p-1~[0-9a-f]{8}@2$/),
      totalLines: 4,
    })
    expect(pageOfLines(lines, { page: 'p-1', cursor: first.nextCursor, maxChars: 8 })).toEqual({
      content: '- c\n- d',
      totalLines: 4,
    })
  })

  it('starts over with a cursor from another page or another query or scope', () => {
    const next = pageOfLines(lines, { page: 'p-1', query: 'a', maxChars: 8 }).nextCursor
    expect(pageOfLines(lines, { page: 'p-2', query: 'a', cursor: next, maxChars: 8 })).toMatchObject({
      content: '- a\n- b',
      restarted: true,
    })
    expect(pageOfLines(lines, { page: 'p-1', cursor: next, maxChars: 8 }).content).toBe('- a\n- b')
    expect(pageOfLines(lines, { page: 'p-1', query: 'a', scope: 'e1', cursor: next, maxChars: 8 }).content).toBe(
      '- a\n- b'
    )
    expect(pageOfLines(lines, { page: 'p-1', query: 'a', cursor: next, maxChars: 8 })).toEqual({
      content: '- c\n- d',
      totalLines: 4,
    })
  })

  it('always shows at least one line', () => {
    expect(pageOfLines(lines, { page: 'p-2', maxChars: 1 })).toMatchObject({ content: '- a' })
  })
})

describe('page snapshot of stacked modal dialogs', () => {
  it('outlines the modal dialog holding the focus, whatever the document order', () => {
    document.body.innerHTML =
      '<dialog open id="top"><p>Discard changes?</p><button>Discard</button></dialog>' +
      '<dialog open id="below"><p>Editor</p><button>Save</button></dialog>'
    const matches = Element.prototype.matches
    const spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':modal' ? this.localName === 'dialog' : matches.call(this, selector)
    })
    try {
      document.querySelector<HTMLButtonElement>('#top button')?.focus()
      const outline = snapshot()
      expect(outline.modal).toBe(true)
      expect(outline.lines.join('\n')).toContain('Discard')
      expect(outline.lines.join('\n')).not.toContain('Save')
    } finally {
      spy.mockRestore()
    }
  })
})
