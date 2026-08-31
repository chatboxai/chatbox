import { app, type BrowserWindow, Menu, type MenuItemConstructorOptions, shell } from 'electron'
import Locale from './locales'

interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string
  submenu?: DarwinMenuItemConstructorOptions[] | Menu
}

export default class MenuBuilder {
  mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  buildMenu(): Menu {
    const locale = new Locale()
    // 监听右键菜单
    this.mainWindow.webContents.on('context-menu', (event, props) => {
      const hasSelection = Boolean(props.selectionText?.trim())

      // 没有选中文本且不是可编辑区域：禁止右键菜单
      if (!hasSelection && !props.isEditable) {
        event.preventDefault()
        return
      }
      const items: (Electron.MenuItem | Electron.MenuItemConstructorOptions)[] = [
        { role: 'copy', label: locale.t('Copy'), accelerator: 'CmdOrCtrl+C', enabled: hasSelection },
        {
          role: 'cut',
          label: locale.t('Cut'),
          accelerator: 'CmdOrCtrl+X',
          enabled: hasSelection && props.isEditable,
        },
        { role: 'paste', label: locale.t('Paste'), accelerator: 'CmdOrCtrl+V', enabled: props.isEditable },
        {
          role: 'pasteAndMatchStyle',
          label: locale.t('PasteAsPlainText'),
          accelerator: 'CmdOrCtrl+Shift+V',
          enabled: props.isEditable,
        },
        { type: 'separator' },
        {
          role: 'selectAll',
          label: locale.t('SelectAll'),
          accelerator: 'CmdOrCtrl+A',
        },
        // { role: 'resetZoom', label: locale.t('ResetZoom'), accelerator: 'CmdOrCtrl+0' },
        // { role: 'zoomIn', label: locale.t('ZoomIn'), accelerator: 'CmdOrCtrl+=' },
        // { role: 'zoomOut', label: locale.t('ZoomOut'), accelerator: 'CmdOrCtrl+-' },
      ]
      // Add each spelling suggestion
      for (const suggestion of props.dictionarySuggestions.slice(0, 3)) {
        items.push({
          label: `${locale.t('ReplaceWith')} "${suggestion}"`,
          click: () => this.mainWindow.webContents.replaceMisspelling(suggestion),
        })
      }
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
        items.push({
          label: 'Inspect element',
          click: () => {
            this.mainWindow.webContents.inspectElement(x, y)
          },
        })
      }
      const { x, y } = props
      Menu.buildFromTemplate(items).popup({ window: this.mainWindow })
    })

    const template = process.platform === 'darwin' ? this.buildDarwinTemplate() : this.buildDefaultTemplate()

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)

    return menu
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: DarwinMenuItemConstructorOptions = {
      label: 'Chatbox',
      submenu: [
        {
          label: 'About Chatbox',
          selector: 'orderFrontStandardAboutPanel:',
        },
        { type: 'separator' },
        { label: 'Services', submenu: [] },
        { type: 'separator' },
        {
          label: 'Hide Chatbox',
          accelerator: 'Command+H',
          selector: 'hide:',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        { label: 'Show All', selector: 'unhideAllApplications:' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            app.quit()
          },
        },
      ],
    }
    const subMenuEdit: DarwinMenuItemConstructorOptions = {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Command+Z', selector: 'undo:' },
        {
          label: 'Redo',
          accelerator: 'Shift+Command+Z',
          selector: 'redo:',
        },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Command+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'Command+C', selector: 'copy:' },
        {
          label: 'Paste',
          accelerator: 'Command+V',
          selector: 'paste:',
        },
        {
          label: 'Paste and Match Style',
          accelerator: 'Command+Shift+V',
          role: 'pasteAndMatchStyle',
        },
        {
          label: 'Select All',
          accelerator: 'Command+A',
          selector: 'selectAll:',
        },
      ],
    }
    const subMenuViewDev: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Command+R',
          click: () => {
            this.mainWindow.webContents.reload()
          },
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen())
          },
        },
        // {
        //     label: 'Reset Zoom',
        //     accelerator: 'Command+0',
        //     role: 'resetZoom',
        // },
        // {
        //     label: 'Zoom In',
        //     accelerator: 'Command+=',
        //     role: 'zoomIn',
        // },
        // {
        //     label: 'Zoom Out',
        //     accelerator: 'Command+-',
        //     role: 'zoomOut',
        // },
        // {
        //   label: 'Toggle Developer Tools',
        //   accelerator: 'Alt+Command+I',
        //   click: () => {
        //     this.mainWindow.webContents.toggleDevTools();
        //   },
        // },
      ],
    }
    const subMenuViewProd: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen())
          },
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+Command+I',
          click: () => {
            this.mainWindow.webContents.toggleDevTools()
          },
        },
      ],
    }
    const subMenuWindow: DarwinMenuItemConstructorOptions = {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Command+M',
          selector: 'performMiniaturize:',
        },
        {
          label: 'Close',
          accelerator: 'Command+W',
          selector: 'performClose:',
        },
        { type: 'separator' },
        { label: 'Bring All to Front', selector: 'arrangeInFront:' },
      ],
    }
    const subMenuHelp: MenuItemConstructorOptions = {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click() {
            shell.openExternal('https://chatboxai.app')
          },
        },
        {
          label: 'Github Repo',
          click() {
            shell.openExternal('https://github.com/chatboxai/chatbox')
          },
        },
        // {
        //   label: 'Community Discussions',
        //   click() {
        //     shell.openExternal('https://www.electronjs.org/community');
        //   },
        // },
        {
          label: 'Search Issues',
          click() {
            shell.openExternal('https://github.com/chatboxai/chatbox/issues?q=is%3Aissue')
          },
        },
      ],
    }

    const subMenuView =
      process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true' ? subMenuViewDev : subMenuViewProd

    return [subMenuAbout, subMenuEdit, subMenuView, subMenuWindow, subMenuHelp]
  }

  buildDefaultTemplate() {
    const templateDefault = [
      {
        label: '&File',
        submenu: [
          {
            label: '&Open',
            accelerator: 'Ctrl+O',
          },
          {
            label: '&Close',
            accelerator: 'Ctrl+W',
            click: () => {
              this.mainWindow.close()
            },
          },
        ],
      },
      {
        label: '&View',
        submenu:
          process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'
            ? [
                {
                  label: '&Reload',
                  accelerator: 'Ctrl+R',
                  click: () => {
                    this.mainWindow.webContents.reload()
                  },
                },
                {
                  label: 'Toggle &Full Screen',
                  accelerator: 'F11',
                  click: () => {
                    this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen())
                  },
                },
                // {
                //   label: 'Toggle &Developer Tools',
                //   accelerator: 'Alt+Ctrl+I',
                //   click: () => {
                //     this.mainWindow.webContents.toggleDevTools();
                //   },
                // },
              ]
            : [
                {
                  label: 'Toggle &Full Screen',
                  accelerator: 'F11',
                  click: () => {
                    this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen())
                  },
                },
              ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Learn More',
            click() {
              shell.openExternal('https://chatboxai.app')
            },
          },
          {
            label: 'Github Repo',
            click() {
              shell.openExternal('https://github.com/chatboxai/chatbox')
            },
          },
          // {
          //   label: 'Community Discussions',
          //   click() {
          //     shell.openExternal('https://www.electronjs.org/community');
          //   },
          // },
          {
            label: 'Search Issues',
            click() {
              shell.openExternal('https://github.com/chatboxai/chatbox/issues?q=is%3Aissue')
            },
          },
        ],
      },
    ]

    return templateDefault
  }
}
