import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const root = process.cwd()
const globalStyles = readFileSync(path.resolve(root, 'src/renderer/static/globals.css'), 'utf8')
const tailwindConfig = readFileSync(path.resolve(root, 'tailwind.config.js'), 'utf8')

/** The rule for `selector` that declares the color tokens. */
function colorTokenBlock(selector: string) {
  const blocks = globalStyles.split(`\n${selector} {`).slice(1)
  const tokens = blocks
    .map((rest) => rest.slice(0, rest.indexOf('\n}')))
    .find((css) => css.includes('--chatbox-background-primary:'))
  expect(tokens).toBeDefined()
  return tokens ?? ''
}

function declaration(css: string, name: string) {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim()
}

const lightRoot = colorTokenBlock(':root')
const darkRoot = colorTokenBlock(':root[data-mantine-color-scheme="dark"]')

describe('raised surface token', () => {
  test('is a Tailwind background color', () => {
    expect(tailwindConfig).toMatch(/background: {[^}]*\n\s+raised: 'var\(--chatbox-background-raised\)',/)
  })

  test('is the primary surface in light mode', () => {
    expect(declaration(lightRoot, '--chatbox-background-raised')).toBe('var(--chatbox-background-primary)')
  })

  test('is a neutral gray above the primary surface in dark mode', () => {
    const raised = declaration(darkRoot, '--chatbox-background-raised') ?? ''
    const primary = declaration(darkRoot, '--chatbox-background-primary') ?? ''
    const channels = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
    expect(raised).toMatch(/^#[0-9a-f]{6}$/i)
    const [r, g, b] = channels(raised)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(r).toBeGreaterThan(channels(primary)[0])
  })

  test('raised surfaces carry the dark text contrast adjustment', () => {
    expect(globalStyles).toMatch(
      /:root\[data-mantine-color-scheme="dark"\] \.bg-chatbox-background-raised,[^{]*{\s*--chatbox-tint-tertiary: var\(--chatbox-tint-secondary\);/
    )
    const rule = /:root\[data-mantine-color-scheme="dark"\] \.bg-chatbox-background-raised,[^{]*{([^}]*)}/.exec(
      globalStyles
    )?.[1]
    expect(rule).toContain('--mantine-color-dimmed: var(--chatbox-tint-secondary);')
  })
})

// Settings cards sit on the raised surface. The primary surface is the page itself, so a card on it
// reads as flat in dark mode next to sections that are raised.
// 1.24 does not have the local-models settings page or UpdateStatus component
// that main's #1787 also retargeted; those files are omitted here.
const SETTINGS_CARD_FILES = [
  'src/renderer/routes/settings/route.tsx',
  'src/renderer/routes/settings/default-models.tsx',
  'src/renderer/routes/settings/about.tsx',
  'src/renderer/components/settings/SettingsLayout.tsx',
]

describe('settings cards', () => {
  test.each(SETTINGS_CARD_FILES)('%s draws cards on the raised surface', (file) => {
    const source = readFileSync(path.resolve(root, file), 'utf8')
    expect(source).not.toMatch(/(?<![:\w-])bg-chatbox-background-primary\b/)
  })

  test.each([
    'src/renderer/components/Shortcut.tsx',
    'src/renderer/components/ModelList.tsx',
    'src/renderer/routes/settings/default-models.tsx',
  ])('%s gives its bordered panel the raised surface', (file) => {
    const source = readFileSync(path.resolve(root, file), 'utf8')
    expect(source).toMatch(
      /border-chatbox-border-primary[^"'`]*bg-chatbox-background-raised|bg-chatbox-background-raised[^"'`]*border-chatbox-border-primary/
    )
  })

  // The class, not a `bg` prop, so the dark text-contrast adjustment that keys on it applies too.
  const expectRaisedPaper = (paper: string) => {
    expect(paper).toMatch(/className="[^"]*\bbg-chatbox-background-raised\b[^"]*"/)
    expect(paper).not.toMatch(/\sbg=/)
  }

  test.each([
    'src/renderer/routes/settings/provider/chatbox-ai/-components/LoginView.tsx',
    'src/renderer/routes/settings/provider/chatbox-ai/-components/LicenseKeyView.tsx',
    'src/renderer/routes/settings/provider/chatbox-ai/-components/LoggedInView.tsx',
  ])('%s puts bordered Papers on the raised surface', (file) => {
    const source = readFileSync(path.resolve(root, file), 'utf8')
    const papers = source.match(/<Paper\b[^>]*withBorder[^>]*>/g) ?? []
    expect(papers.length).toBeGreaterThan(0)
    for (const paper of papers) expectRaisedPaper(paper)
  })

  test('the knowledge base documents panel sits on the raised surface', () => {
    const source = readFileSync(
      path.resolve(root, 'src/renderer/components/knowledge-base/KnowledgeBaseDocuments.tsx'),
      'utf8'
    )
    const panel = /<Paper withBorder radius="lg" p=\{0\}[^>]*>/.exec(source)?.[0] ?? ''
    expectRaisedPaper(panel)
  })
})
