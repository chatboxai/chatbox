import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { compareWithBaseline, countColorLiterals, scanRendererColors } from './check-renderer-colors.mjs'

function withFixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'chatbox-renderer-colors-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      const filePath = join(root, path)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    }
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('counts hex, rgb, Tailwind palette and Mantine palette colors', () => {
  assert.equal(countColorLiterals(`const a = '#2563eb'; const b = "#fff"; const c = '#ffffff80'`), 3)
  assert.equal(countColorLiterals(`style={{ backgroundColor: 'rgba(222, 226, 230, 1)' }}`), 1)
  assert.equal(countColorLiterals(`className="bg-red-50 dark:bg-red-900/20 text-blue-500 border-t-gray-200"`), 4)
  assert.equal(countColorLiterals(`<Text c="blue">`), 1)
  assert.equal(countColorLiterals(`className="shadow-[0_4px_20px_rgba(0,0,0,0.1)] ring-[0_0_0_1px_#e5e7eb]"`), 2)
})

test('ignores tokens, entities, anchors and non-color identifiers', () => {
  assert.equal(countColorLiterals(`className="text-chatbox-tint-error bg-chatbox-background-brand-secondary"`), 0)
  assert.equal(countColorLiterals(`<Text c="chatbox-brand">`), 0)
  assert.equal(countColorLiterals(`const s = 'var(--chatbox-tint-brand)'`), 0)
  assert.equal(countColorLiterals(`const e = '&#123;'; const h = 'https://x.dev/#faq'; const issue = 'see #1234'`), 0)
  assert.equal(countColorLiterals(`className="text-white bg-black/50 text-sm"`), 0)
})

test('scans renderer sources and skips tests and stories', () => {
  withFixture(
    {
      'src/renderer/a.tsx': `<div className="text-red-500" />`,
      'src/renderer/b.ts': `export const ok = 'var(--chatbox-tint-brand)'`,
      'src/renderer/a.test.tsx': `const c = '#fff'`,
      'src/renderer/c.stories.tsx': `const c = '#fff'`,
      'src/renderer/__tests__/d.tsx': `const c = '#fff'`,
      'src/main/e.ts': `const c = '#fff'`,
    },
    (root) => {
      assert.deepEqual(scanRendererColors(root), { 'src/renderer/a.tsx': 1 })
    }
  )
})

test('fails new or increased usages and reports reductions', () => {
  const { violations, improvements } = compareWithBaseline(
    { 'src/renderer/new.tsx': 1, 'src/renderer/grew.tsx': 3, 'src/renderer/shrank.tsx': 1 },
    { 'src/renderer/grew.tsx': 2, 'src/renderer/shrank.tsx': 2, 'src/renderer/cleaned.tsx': 4 }
  )
  assert.deepEqual(violations, [
    { file: 'src/renderer/new.tsx', count: 1, allowed: 0 },
    { file: 'src/renderer/grew.tsx', count: 3, allowed: 2 },
  ])
  assert.deepEqual(improvements, [
    { file: 'src/renderer/shrank.tsx', count: 1, allowed: 2 },
    { file: 'src/renderer/cleaned.tsx', count: 0, allowed: 4 },
  ])
})
