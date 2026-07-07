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

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspaice-e2e-'))
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
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text())
      }
    })
    await use(errors)
  },
})

test.describe.configure({ mode: 'serial' })

test.afterEach(({ rendererErrors }) => {
  expect(rendererErrors).toEqual([])
})

test('launches to the first meaningful chat screen', async ({ app, page }) => {
  await expect(page).toHaveTitle(/WorkspAIce|Electron/)
  await expect(page.getByText('What can I help you with today?')).toBeVisible()
  await expect(page.getByTestId('message-input')).toBeVisible()
  await expect(page.getByTestId('new-chat-button')).toBeVisible()
  await expect(page.locator('.vite-error-overlay')).toHaveCount(0)

  const appPath = await app.evaluate(async ({ app }) => app.getAppPath())
  expect(appPath).toContain('workspaice')
})

test('opens model provider settings and edits a mock custom provider', async ({ page }) => {
  await page.getByTestId('settings-nav-link').click()
  await expect(page.getByText('Settings').first()).toBeVisible()
  await expect(page.getByText('Model Provider')).toBeVisible()

  await page.getByTestId('add-provider-button').click()
  await page.getByText('Add Custom Provider').click()
  await page.getByTestId('custom-provider-name-input').fill('E2E Mock Provider')
  await page.getByTestId('custom-provider-add-button').click()

  await expect(page.getByTestId('provider-name-input')).toHaveValue('E2E Mock Provider')
  await page.getByTestId('provider-api-host-input').fill('http://127.0.0.1:9/v1')
  await page.getByTestId('provider-api-key-input').fill('sk-e2e-not-real')

  await expect(page.getByTestId('provider-api-host-input')).toHaveValue('http://127.0.0.1:9/v1')
  await expect(page.getByTestId('provider-api-key-input')).toHaveValue('sk-e2e-not-real')
})

test('points a provider-less profile at provider setup from the empty state', async ({ page }) => {
  // The page fixture already dismissed the first-run onboarding modal ("Setup later"),
  // which itself proves the modal appears on a fresh profile. The empty state keeps a CTA.
  await expect(page.getByText('No AI provider configured yet')).toBeVisible()
  await page.getByTestId('empty-state-setup-provider').click()
  await expect(page.getByText('Model Provider')).toBeVisible()
})

test('preserves composer draft input without calling a provider', async ({ page }) => {
  await page.getByTestId('message-input').fill('E2E draft message that must stay local')
  await expect(page.getByTestId('message-input')).toHaveValue('E2E draft message that must stay local')
})

test('opens the image creator and preserves a local prompt draft', async ({ page }) => {
  await page.getByTestId('new-image-button').click()
  await expect(page.getByText('Image Creator', { exact: true }).first()).toBeVisible()

  const prompt = page.getByPlaceholder('Describe the image you want to create...')
  await prompt.fill('A geometric WorkspAIce desktop wallpaper')
  await expect(prompt).toHaveValue('A geometric WorkspAIce desktop wallpaper')
})

test('creates, renames, creates a chat inside, and deletes a workspace', async ({ page }) => {
  await page.getByTestId('new-workspace-button').click()
  await page.getByTestId('workspace-name-input').fill('E2E Workspace')
  await page.getByTestId('workspace-save-button').click()

  const workspaceRow = page.locator('[data-testid^="workspace-row-"]').filter({ hasText: 'E2E Workspace' })
  await expect(workspaceRow).toBeVisible()
  const workspaceTestId = await workspaceRow.getAttribute('data-testid')
  const workspaceId = workspaceTestId?.replace('workspace-row-', '')
  expect(workspaceId).toBeTruthy()

  await workspaceRow.hover()
  await page.getByTestId(`new-chat-in-workspace-${workspaceId}`).click()
  await expect(workspaceRow.getByText('1')).toBeVisible()

  await workspaceRow.hover()
  await workspaceRow.getByLabel('Workspace actions').click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByTestId('workspace-name-input').fill('E2E Workspace Renamed')
  await page.getByTestId('workspace-save-button').click()
  await expect(page.locator(`[data-testid="workspace-row-${workspaceId}"]`)).toContainText('E2E Workspace Renamed')

  const renamedWorkspaceRow = page.locator(`[data-testid="workspace-row-${workspaceId}"]`)
  await renamedWorkspaceRow.hover()
  await renamedWorkspaceRow.getByLabel('Workspace actions').click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('menuitem', { name: 'Delete Workspace and Chats?' }).click()
  await expect(page.locator(`[data-testid="workspace-row-${workspaceId}"]`)).toHaveCount(0)
})

test('opens the command palette with Cmd/Ctrl+K and navigates via an action', async ({ page }) => {
  // The keydown listener is attached on React mount — wait for the app to be interactive first
  await expect(page.getByTestId('message-input')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  const paletteInput = page.getByPlaceholder('Type a command or search conversations...')
  await expect(paletteInput).toBeVisible()

  // Filter to a command and run it
  await paletteInput.fill('Create Image')
  const imageAction = page.getByText('Open the image creator')
  await expect(imageAction).toBeVisible()
  await imageAction.click()
  await expect(paletteInput).toBeHidden()
  await expect(page.getByText('Image Creator', { exact: true }).first()).toBeVisible()

  // Palette toggles closed with the same shortcut
  await page.keyboard.press('ControlOrMeta+k')
  await expect(paletteInput).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(paletteInput).toBeHidden()

  // Search moved to Cmd/Ctrl+Shift+F (same shortcut toggles it closed)
  const searchInput = page.getByPlaceholder('Type a command or search...', { exact: true })
  await page.keyboard.press('ControlOrMeta+Shift+f')
  await expect(searchInput).toBeVisible()
  await page.keyboard.press('ControlOrMeta+Shift+f')
  await expect(searchInput).toBeHidden()
})

test('finds a locally-sent message via cross-conversation search', async ({ page }) => {
  // Seed a mock provider + model so the composer accepts a message (no network:
  // Ctrl+Enter sends without generating a response)
  await page.getByTestId('settings-nav-link').click()
  await page.getByTestId('add-provider-button').click()
  await page.getByText('Add Custom Provider').click()
  await page.getByTestId('custom-provider-name-input').fill('E2E Search Provider')
  await page.getByTestId('custom-provider-add-button').click()
  await page.getByTestId('provider-api-host-input').fill('http://127.0.0.1:9/v1')
  await page.getByText('New', { exact: true }).click()
  const modelEditDialog = page.getByRole('dialog', { name: 'Edit Model' })
  await modelEditDialog.getByRole('textbox').first().fill('mock-model')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.keyboard.press('Escape') // close settings modal

  // Pick the model in the composer and send without response
  await page.getByText('Select Model').click()
  await page.getByText('mock-model').first().click()
  await page.getByTestId('message-input').fill('zebra quantum searchable e2e message')
  await page.keyboard.press('Control+Enter')
  // The message renders in the created session's message list
  await expect(page.getByTestId('message-input')).toHaveValue('')

  // Open global search (Cmd/Ctrl+Shift+F), search across all conversations
  await page.keyboard.press('ControlOrMeta+Shift+f')
  const searchInput = page.getByPlaceholder('Type a command or search...', { exact: true })
  await expect(searchInput).toBeVisible()
  await searchInput.fill('quantum searchable')
  await page.getByText('Search All Conversations', { exact: false }).click()

  // A result group for the chat appears with the matched message
  await expect(page.getByText(/^Chat ".*":$/).first()).toBeVisible()
  await expect(page.getByText('zebra quantum searchable e2e message').first()).toBeVisible()
})

test('enters and cancels empty bulk chat selection without mutating sessions', async ({ page }) => {
  await page.getByTestId('select-chats-button').click()

  const toolbar = page.getByTestId('bulk-selection-toolbar')
  await expect(toolbar).toBeVisible()
  await expect(toolbar).toContainText('Select chats')
  await expect(page.getByTestId('move-selected-chats-button')).toBeDisabled()
  await expect(page.getByTestId('delete-selected-chats-button')).toBeDisabled()

  await page.getByTestId('cancel-chat-selection-button').click()
  await expect(toolbar).toHaveCount(0)
})
