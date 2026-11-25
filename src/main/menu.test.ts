import type { BrowserWindow, ContextMenuParams, Event } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
  popup: vi.fn(),
  setApplicationMenu: vi.fn(),
  getSettings: vi.fn(() => ({ language: 'en' })),
}))

vi.mock('electron', () => ({
  app: {
    getLocale: vi.fn(() => 'en'),
    quit: vi.fn(),
  },
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate,
    setApplicationMenu: mocks.setApplicationMenu,
  },
  MenuItem: class {},
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('./store-node', () => ({
  getSettings: mocks.getSettings,
}))

import MenuBuilder from './menu'

type ContextMenuHandler = (event: Event, props: ContextMenuParams) => void

function createWindow() {
  let contextMenuHandler: ContextMenuHandler | undefined
  const mainWindow = {
    webContents: {
      inspectElement: vi.fn(),
      on: vi.fn((eventName: string, handler: ContextMenuHandler) => {
        if (eventName === 'context-menu') {
          contextMenuHandler = handler
        }
      }),
      reload: vi.fn(),
      replaceMisspelling: vi.fn(),
      session: {
        addWordToSpellCheckerDictionary: vi.fn(),
      },
    },
  } as unknown as BrowserWindow

  return {
    getContextMenuHandler: () => {
      if (!contextMenuHandler) {
        throw new Error('context-menu handler was not registered')
      }
      return contextMenuHandler
    },
    mainWindow,
  }
}

describe('desktop context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockReturnValue({ language: 'en' })
    mocks.buildFromTemplate.mockReturnValue({ popup: mocks.popup })
  })

  it('allows paste in an editable field without a text selection', () => {
    const { getContextMenuHandler, mainWindow } = createWindow()
    new MenuBuilder(mainWindow).buildMenu()
    const event = { preventDefault: vi.fn() } as unknown as Event

    getContextMenuHandler()(event, {
      dictionarySuggestions: [],
      isEditable: true,
      selectionText: '',
      x: 12,
      y: 34,
    } as unknown as ContextMenuParams)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mocks.buildFromTemplate).toHaveBeenCalledTimes(2)
    const contextMenuTemplate = mocks.buildFromTemplate.mock.calls[1][0]
    expect(contextMenuTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: false, role: 'copy' }),
        expect.objectContaining({ enabled: false, role: 'cut' }),
        expect.objectContaining({ enabled: true, role: 'paste' }),
        expect.objectContaining({ role: 'selectAll' }),
      ])
    )
    expect(mocks.popup).toHaveBeenCalledWith({ window: mainWindow })
  })

  it('keeps copy and cut available when editable text is selected', () => {
    const { getContextMenuHandler, mainWindow } = createWindow()
    new MenuBuilder(mainWindow).buildMenu()

    getContextMenuHandler()(
      { preventDefault: vi.fn() } as unknown as Event,
      {
        dictionarySuggestions: [],
        isEditable: true,
        selectionText: 'selected text',
        x: 12,
        y: 34,
      } as unknown as ContextMenuParams
    )

    const contextMenuTemplate = mocks.buildFromTemplate.mock.calls[1][0]
    expect(contextMenuTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: true, role: 'copy' }),
        expect.objectContaining({ enabled: true, role: 'cut' }),
      ])
    )
  })

  it('keeps the context menu hidden outside editable fields when nothing is selected', () => {
    const { getContextMenuHandler, mainWindow } = createWindow()
    new MenuBuilder(mainWindow).buildMenu()
    const event = { preventDefault: vi.fn() } as unknown as Event

    getContextMenuHandler()(event, {
      dictionarySuggestions: [],
      isEditable: false,
      selectionText: '',
      x: 12,
      y: 34,
    } as unknown as ContextMenuParams)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.buildFromTemplate).toHaveBeenCalledOnce()
    expect(mocks.popup).not.toHaveBeenCalled()
  })

  it('labels the context menu with the application language, not the OS language', () => {
    mocks.getSettings.mockReturnValue({ language: 'fr' })
    const { getContextMenuHandler, mainWindow } = createWindow()
    new MenuBuilder(mainWindow).buildMenu()

    getContextMenuHandler()(
      { preventDefault: vi.fn() } as unknown as Event,
      {
        dictionarySuggestions: [],
        isEditable: true,
        selectionText: 'texte',
        x: 12,
        y: 34,
      } as unknown as ContextMenuParams
    )

    const contextMenuTemplate = mocks.buildFromTemplate.mock.calls[1][0]
    expect(contextMenuTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Copier', role: 'copy' }),
        expect.objectContaining({ label: 'Couper', role: 'cut' }),
        expect.objectContaining({ label: 'Coller', role: 'paste' }),
        expect.objectContaining({ label: 'Tout sélectionner', role: 'selectAll' }),
      ])
    )
  })

  it('offers to add a misspelled word to the dictionary', () => {
    const { getContextMenuHandler, mainWindow } = createWindow()
    new MenuBuilder(mainWindow).buildMenu()

    getContextMenuHandler()(
      { preventDefault: vi.fn() } as unknown as Event,
      {
        dictionarySuggestions: ['chatbox'],
        isEditable: true,
        misspelledWord: 'chatbax',
        selectionText: '',
        x: 12,
        y: 34,
      } as unknown as ContextMenuParams
    )

    const contextMenuTemplate = mocks.buildFromTemplate.mock.calls[1][0]
    const suggestionItem = contextMenuTemplate.find((item: { label?: string }) => item.label === 'Replace with "chatbox"')
    const dictionaryItem = contextMenuTemplate.find(
      (item: { label?: string }) => item.label === 'Add to Dictionary "chatbax"'
    )
    expect(suggestionItem).toBeDefined()
    expect(dictionaryItem).toBeDefined()

    dictionaryItem.click()
    expect(mainWindow.webContents.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('chatbax')
  })

  it('does not offer the dictionary entry when no word is misspelled', () => {
    const { getContextMenuHandler, mainWindow } = createWindow()
    new MenuBuilder(mainWindow).buildMenu()

    getContextMenuHandler()(
      { preventDefault: vi.fn() } as unknown as Event,
      {
        dictionarySuggestions: [],
        isEditable: true,
        misspelledWord: '',
        selectionText: 'selected text',
        x: 12,
        y: 34,
      } as unknown as ContextMenuParams
    )

    const contextMenuTemplate = mocks.buildFromTemplate.mock.calls[1][0]
    expect(contextMenuTemplate.some((item: { label?: string }) => item.label?.startsWith('Add to Dictionary'))).toBe(
      false
    )
  })
})
