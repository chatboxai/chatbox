import type { ElectronApplication, Page } from 'playwright'
import { afterEach, expect, test, vi } from 'vitest'
import { resolveQaWindowBounds } from '../../src/main/qa-window'
import { setElectronQaViewport } from '../e2e/electron-qa-window'

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }

afterEach(() => vi.unstubAllEnvs())

for (const [layout, secondary, cursor] of [
  ['left', { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }, { x: 1600, y: 100 }],
  ['top', { id: 2, workArea: { x: 0, y: 900, width: 1440, height: 900 } }, { x: 100, y: 1000 }],
] as const) {
  for (const viewport of [
    { width: 800, height: 600 },
    { width: 1500, height: 1000 },
  ]) {
    test(`keeps a visible edge when ${layout}-parked QA is resized to ${viewport.width}x${viewport.height}`, async () => {
      vi.stubEnv('CHATBOX_QA', '1')
      vi.stubEnv('CHATBOX_QA_WINDOW', 'park')
      const displays = [primary, secondary]
      let bounds = resolveQaWindowBounds({ displays, cursor, mode: 'park', width: 1280, height: 824 })
      const center = vi.fn()
      const window = {
        id: 1,
        isDestroyed: () => false,
        getBounds: () => bounds,
        getContentBounds: () => ({ ...bounds, height: bounds.height - 24 }),
        setContentSize: (width: number, height: number) => {
          bounds = { ...bounds, width, height: height + 24 }
        },
        setPosition: (x: number, y: number) => {
          bounds = { ...bounds, x, y }
        },
        center,
      }
      const electron = {
        BrowserWindow: { getAllWindows: () => [window], fromId: () => window },
        screen: { getAllDisplays: () => displays, getCursorScreenPoint: () => cursor },
      }
      const app = {
        evaluate: async (callback: (host: typeof electron, argument: unknown) => unknown, argument: unknown) =>
          callback(electron, argument),
      } as unknown as ElectronApplication
      const page = {
        waitForFunction: async () => {},
        evaluate: async () => ({ deviceScaleFactor: 1, viewport }),
        viewportSize: () => viewport,
        context: () => ({
          newCDPSession: async () => ({
            send: async () => ({ cssLayoutViewport: { clientWidth: viewport.width, clientHeight: viewport.height } }),
            detach: async () => {},
          }),
        }),
      } as unknown as Page

      await setElectronQaViewport(app, page, viewport)

      expect(center).not.toHaveBeenCalled()
      if (layout === 'left') expect(bounds.x + bounds.width).toBe(primary.workArea.x + 64)
      else expect(bounds.y + bounds.height).toBe(primary.workArea.y + 64)
      expect(bounds.width).toBe(viewport.width)
      expect(bounds.height).toBe(viewport.height + 24)
    })
  }
}
