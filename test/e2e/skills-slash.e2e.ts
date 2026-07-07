import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test as base, type ElectronApplication, _electron as electron, expect, type Page } from '@playwright/test'

type Fixtures = {
  app: ElectronApplication
  page: Page
  rendererErrors: string[]
}

const require = createRequire(__filename)
const electronPath = require('electron') as string
const rootDir = path.resolve(__dirname, '../..')
const mainEntry = path.join(rootDir, 'release/app/dist/main/main.js')
const rendererEntry = path.join(rootDir, 'release/app/dist/renderer/index.html')

const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture factories require object destructuring.
  app: async ({}, use) => {
    if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
      throw new Error('E2E requires a built app. Run `pnpm build` before `playwright test`.')
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspaice-e2e-skills-'))
    const app = await electron.launch({
      executablePath: electronPath,
      args: [mainEntry],
      cwd: rootDir,
      timeout: 60_000,
      env: {
        ...process.env,
        CI: '1',
        NODE_ENV: 'production',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        WORKSPAICE_DISABLE_GPU: '1',
        WORKSPAICE_E2E_USER_DATA_DIR: userDataDir,
      },
    })

    try {
      await use(app)
    } finally {
      await app.close()
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // Fresh profiles have no provider configured, so the first-run onboarding
    // modal (FABLE F1) always appears — dismiss it so tests start at the chat screen.
    await page.getByRole('button', { name: 'Setup later' }).click()
    await use(page)
  },
  rendererErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await use(errors)
  },
})

test.describe.configure({ mode: 'serial' })

test.afterEach(({ rendererErrors }) => {
  expect(rendererErrors).toEqual([])
})

const SKILL_NAME = 'e2e-test-skill'

test('creates a skill in Settings and invokes it via "/" in the composer', async ({ page }) => {
  // Settings → Skills lives under MCP
  await page.getByTestId('settings-nav-link').click()
  await expect(page.getByText('MCP', { exact: true })).toBeVisible()
  await page.getByText('Skills', { exact: true }).first().click()

  // Create a skill via the in-app editor
  await page.getByTestId('new-skill-button').click()
  await page.getByTestId('skill-name-input').fill(SKILL_NAME)
  await page.getByTestId('skill-description-input').fill('E2E skill used to verify slash invocation.')
  await page.getByTestId('skill-instructions-input').fill('# Instructions\n\nRespond with the word OK.')
  await page.getByTestId('skill-create-button').click()

  // It appears in the user skills list (auto-enabled on create)
  await expect(page.getByText(SKILL_NAME).first()).toBeVisible()

  // Back to a chat and open the slash picker
  await page.keyboard.press('Escape')
  await expect(page.locator('.mantine-Modal-overlay')).toHaveCount(0)
  await page.getByTestId('new-chat-button').click()
  const input = page.getByTestId('message-input')
  await input.click()
  await input.fill('/')

  // The enabled skill shows in the "/" menu; selecting it fills the composer
  const option = page.getByText(`/${SKILL_NAME}`, { exact: true })
  await expect(option).toBeVisible()
  await option.click()
  await expect(input).toHaveValue(new RegExp(`^/${SKILL_NAME}\\s`))
})
