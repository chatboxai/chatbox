import { expect, type Locator, type Page } from '@playwright/test'
import type { Message, Session } from '../../../packages/chatbox-core/src/types'
import { TestId } from '../../../src/shared/automation/testids'
import { openSeededSession, seedLegacySessions } from '../desktop/row-fixtures'
import { waitForTranscript } from '../desktop/transcript-qa'
import { MOCK_MODEL_ID, MOCK_PROVIDER_ID } from '../shared/settings'
import { openWebQa, test } from './fixtures'

const WALLPAPER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="32" height="64" fill="#e4572e"/><rect x="32" width="32" height="64" fill="#17bebb"/></svg>'
)}`

const messages: Message[] = [
  {
    id: 'glass-0',
    role: 'user',
    timestamp: 1700000000000,
    contentParts: [{ type: 'text', text: 'Plan a beach day.' }],
  },
  {
    id: 'glass-1',
    role: 'assistant',
    model: MOCK_MODEL_ID,
    timestamp: 1700000001000,
    contentParts: [{ type: 'text', text: 'Leave early and pack sunscreen.' }],
  },
]

type Glass = { blurred: boolean; alpha: number }

function glassOf(locator: Locator): Promise<Glass> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const color = style.backgroundColor
    // rgb(r, g, b), rgba(r, g, b, a) or color(srgb r g b / a)
    const channels = /\(([^)]*)\)/.exec(color)?.[1] ?? ''
    const alpha =
      color === 'transparent'
        ? 0
        : channels.includes('/')
          ? Number(channels.split('/')[1])
          : color.startsWith('rgba')
            ? Number(channels.split(',')[3])
            : 1
    return { blurred: style.backdropFilter.includes('blur'), alpha }
  })
}

async function openChat(page: Page, baseURL: string | undefined, wallpaper: boolean) {
  await openWebQa(page, baseURL)
  await seedLegacySessions(page, [
    {
      id: 'glass-session',
      name: 'Glass',
      settings: { provider: MOCK_PROVIDER_ID, modelId: MOCK_MODEL_ID },
      messages,
      ...(wallpaper ? { backgroundImage: { type: 'url', url: WALLPAPER } } : {}),
    } as Session,
  ])
  await openSeededSession(page, 'glass-session')
  await waitForTranscript(page)
  if (wallpaper) await expect(page.locator('html')).toHaveAttribute('data-chat-wallpaper', '')
}

async function headerMenu(page: Page) {
  await page.getByTestId(TestId.session.headerMenuTrigger).first().click()
  return page.getByTestId(TestId.session.headerMenu).first()
}

test.describe('chat wallpaper glass', () => {
  test('popups and the composer blur over a wallpaper, while transcript content is an unblurred fill', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openChat(page, baseURL, true)

    const bubble = page.locator('[data-transcript-message="glass-0"] [data-testid="message-content"]')
    expect(await glassOf(bubble)).toEqual({ blurred: false, alpha: expect.any(Number) })
    expect((await glassOf(bubble)).alpha).toBeLessThan(1)

    const composer = page.locator('.chatbox-composer-surface').first()
    expect((await glassOf(composer)).blurred).toBe(true)

    const menu = await headerMenu(page)
    const menuGlass = await glassOf(menu)
    expect(menuGlass.blurred).toBe(true)
    expect(menuGlass.alpha).toBeLessThan(1)
    await page.keyboard.press('Escape')

    await page.getByTestId(TestId.model.selectorTrigger).first().click()
    const panelGlass = await glassOf(page.getByTestId(TestId.model.selectorPanel).first())
    expect(panelGlass.blurred).toBe(true)
    expect(panelGlass.alpha).toBeLessThan(1)
  })

  test('without a wallpaper popups stay opaque and unblurred', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openChat(page, baseURL, false)
    await expect(page.locator('html')).not.toHaveAttribute('data-chat-wallpaper')

    expect(await glassOf(await headerMenu(page))).toEqual({ blurred: false, alpha: 1 })
    expect((await glassOf(page.locator('.chatbox-composer-surface').first())).blurred).toBe(false)
  })

  test('mobile bottom drawers are glass over a wallpaper', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openChat(page, baseURL, true)

    await page.getByTestId(TestId.model.selectorTrigger).first().click()
    const drawer = page.locator('[data-vaul-drawer]').filter({ has: page.getByTestId(TestId.model.selectorPanel) })
    await expect(drawer).toBeVisible()
    const drawerGlass = await glassOf(drawer)
    expect(drawerGlass.blurred).toBe(true)
    expect(drawerGlass.alpha).toBeLessThan(1)
  })
})
