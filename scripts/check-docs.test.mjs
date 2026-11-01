import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkDocs, trackedMarkdownFiles, validatePlanRegistry } from './check-docs.mjs'

function createDocumentationRepository(markdown) {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-docs-check-'))
  mkdirSync(path.join(repositoryRoot, 'docs/product'), { recursive: true })
  mkdirSync(path.join(repositoryRoot, 'docs/technical'), { recursive: true })
  mkdirSync(path.join(repositoryRoot, 'docs/plans'), { recursive: true })
  writeFileSync(path.join(repositoryRoot, 'AGENTS.md'), '# Repository instructions\n')
  writeFileSync(path.join(repositoryRoot, 'CLAUDE.md'), '@AGENTS.md\n')
  writeFileSync(path.join(repositoryRoot, 'guide.md'), markdown)
  writeFileSync(path.join(repositoryRoot, 'docs/index.md'), '# Documentation\n')
  writeFileSync(path.join(repositoryRoot, 'docs/product/index.md'), '# Product\n')
  writeFileSync(path.join(repositoryRoot, 'docs/technical/index.md'), '# Technical\n')
  writeFileSync(path.join(repositoryRoot, 'docs/plans/README.md'), '# Plans\n')
  writeFileSync(path.join(repositoryRoot, 'docs/plans/TEMPLATE.md'), '# Plan template\n')
  writeFileSync(
    path.join(repositoryRoot, 'docs/plans/registry.json'),
    JSON.stringify({ schemaVersion: 1, updatedAt: '2026-08-31', plans: [] })
  )
  execFileSync('git', ['init', '--quiet'], { cwd: repositoryRoot })
  execFileSync('git', ['add', '.'], { cwd: repositoryRoot })
  return repositoryRoot
}

test('the checked-in documentation and plan registry are valid', () => {
  assert.deepEqual(checkDocs().errors, [])
})

test('scans tracked Markdown outside the root and docs directory', () => {
  const markdownFiles = trackedMarkdownFiles()

  assert.ok(markdownFiles.includes('README-CN.md'))
  assert.ok(markdownFiles.includes('.github/ISSUE_TEMPLATE/bug_report.md'))
  assert.ok(markdownFiles.includes('.claude/rules/generation-flow.md'))
  assert.ok(!markdownFiles.includes('.claude/skills/playwright-cli/SKILL.md'))
})

test('rejects missing relative targets in inline HTML and reference definitions', () => {
  const repositoryRoot = createDocumentationRepository(
    '<a href="./missing-page.md">Missing page</a>\n\n[missing-image]: ./missing-image.png\n'
  )
  try {
    const errors = checkDocs(repositoryRoot).errors.join('\n')

    assert.match(errors, /missing documentation link target \.\/missing-page\.md/)
    assert.match(errors, /missing documentation link target \.\/missing-image\.png/)
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('parses nested links and balanced destination parentheses', () => {
  const repositoryRoot = createDocumentationRepository(
    '[![Missing image](./missing-image.png)](./missing-page.md)\n'
  )
  try {
    const errors = checkDocs(repositoryRoot).errors.join('\n')

    assert.match(errors, /missing documentation link target \.\/missing-image\.png/)
    assert.match(errors, /missing documentation link target \.\/missing-page\.md/)

    writeFileSync(path.join(repositoryRoot, 'guide_(draft).md'), '# Draft\n')
    writeFileSync(path.join(repositoryRoot, 'guide.md'), '[Draft](./guide_(draft).md)\n')
    assert.deepEqual(checkDocs(repositoryRoot).errors, [])
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('ignores GitHub footnote definitions', () => {
  const repositoryRoot = createDocumentationRepository(
    'A documented fact.[^note]\n\n[^note]: Supporting explanation, not a file link.\n'
  )
  try {
    assert.deepEqual(checkDocs(repositoryRoot).errors, [])
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('follows CommonMark code boundaries when checking links', () => {
  const repositoryRoot = createDocumentationRepository('    ```\n[Missing](./missing.md)\n')
  try {
    assert.match(checkDocs(repositoryRoot).errors.join('\n'), /missing documentation link target \.\/missing\.md/)

    writeFileSync(path.join(repositoryRoot, 'guide.md'), '    [Code example](./missing.md)\n')
    assert.deepEqual(checkDocs(repositoryRoot).errors, [])

    writeFileSync(path.join(repositoryRoot, 'guide.md'), '- Item\n\n    [Missing](./missing.md)\n')
    assert.match(checkDocs(repositoryRoot).errors.join('\n'), /missing documentation link target \.\/missing\.md/)

    writeFileSync(path.join(repositoryRoot, 'guide.md'), '- Item\n\n      [Code example](./missing.md)\n')
    assert.deepEqual(checkDocs(repositoryRoot).errors, [])

    writeFileSync(
      path.join(repositoryRoot, 'guide.md'),
      '> ~~~md\n> [Code example](./missing.md)\n> ~~~\n'
    )
    assert.deepEqual(checkDocs(repositoryRoot).errors, [])

    writeFileSync(path.join(repositoryRoot, 'guide.md'), '`[Code example](./missing.md)`\n')
    assert.deepEqual(checkDocs(repositoryRoot).errors, [])
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('rejects documentation targets outside the repository', () => {
  const repositoryRoot = createDocumentationRepository('')
  const outsideFile = `${path.basename(repositoryRoot)}-outside.md`
  const outsidePath = path.join(repositoryRoot, '..', outsideFile)
  try {
    writeFileSync(outsidePath, '# Outside\n')
    writeFileSync(path.join(repositoryRoot, 'guide.md'), `[Outside](../${outsideFile})\n`)

    assert.match(checkDocs(repositoryRoot).errors.join('\n'), /link target leaves the repository/)
  } finally {
    rmSync(outsidePath, { force: true })
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('requires top-level product and technical documents to be indexed', () => {
  const repositoryRoot = createDocumentationRepository('')
  try {
    writeFileSync(path.join(repositoryRoot, 'docs/technical/orphan.md'), '# Orphan\n')

    assert.match(checkDocs(repositoryRoot).errors.join('\n'), /technical\/index\.md does not index \.\/orphan\.md/)
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('accepts an indexed category document without a dot-slash prefix', () => {
  const repositoryRoot = createDocumentationRepository('')
  try {
    writeFileSync(path.join(repositoryRoot, 'docs/technical/architecture.md'), '# Architecture\n')
    writeFileSync(
      path.join(repositoryRoot, 'docs/technical/index.md'),
      '# Technical\n\n[Architecture](architecture.md)\n'
    )

    assert.deepEqual(checkDocs(repositoryRoot).errors, [])
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('rejects an unknown plan directory without a canonical entrypoint', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans/unknown'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'docs/plans/known.md'), '# Known plan\n')
    writeFileSync(path.join(repositoryRoot, 'docs/plans/unknown/stage.md'), '# Unindexed plan stage\n')
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [{ path: 'docs/plans/known.md', status: 'needs-triage' }],
    }
    const index = '| Plan | Status |\n|---|---|\n| [Known](./known.md) | Needs triage |\n'

    assert.match(
      validatePlanRegistry(registry, { repositoryRoot, index }).join('\n'),
      /unknown\/ must provide README\.md or refactor-plan\.md/
    )
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('requires ownership for an active plan', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'docs/plans/active.md'), '# Active plan\n')
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [{ path: 'docs/plans/active.md', status: 'in-progress', reviewedAt: '2026-08-31' }],
    }
    const index = '| Plan | Status |\n|---|---|\n| [Active](./active.md) | In progress |\n'

    assert.match(validatePlanRegistry(registry, { repositoryRoot, index }).join('\n'), /owner is required/)
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('Needs triage entries cannot claim reviewed metadata', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'docs/plans/legacy.md'), '# Legacy plan\n')
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [
        {
          path: 'docs/plans/legacy.md',
          status: 'needs-triage',
          owner: 'guessed-owner',
        },
      ],
    }
    const index = '| Plan | Status |\n|---|---|\n| [Legacy](./legacy.md) | Needs triage |\n'

    assert.match(validatePlanRegistry(registry, { repositoryRoot, index }).join('\n'), /must not claim reviewed/)
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('keeps plan document status and index section aligned with the registry', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'docs/plans/delivery.md'), '# Delivery\n\n> Status: In progress\n')
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [{ path: 'docs/plans/delivery.md', status: 'completed', reviewedAt: '2026-08-31' }],
    }
    const index =
      '# Plans\n\n## Active\n\n| Plan | Status |\n|---|---|\n| [Delivery](./delivery.md) | Completed |\n'
    const errors = validatePlanRegistry(registry, { repositoryRoot, index }).join('\n')

    assert.match(errors, /must list \.\/delivery\.md under ## Completed/)
    assert.match(errors, /delivery\.md must declare > Status: Completed/)
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('accepts a reference-style plan index link without a dot-slash prefix', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans/linked'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'docs/plans/linked/README.md'), '# Linked\n\n> Status: Completed\n')
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [{ path: 'docs/plans/linked/README.md', status: 'completed', reviewedAt: '2026-08-31' }],
    }
    const index =
      '# Plans\n\n## Completed\n\n| Plan | Status |\n|---|---|\n| [Linked][linked-plan] | Completed |\n\n[linked-plan]: linked/README.md#result\n'

    assert.deepEqual(validatePlanRegistry(registry, { repositoryRoot, index }), [])
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('ignores plan index rows and status metadata in non-rendered Markdown', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans'), { recursive: true })
    writeFileSync(
      path.join(repositoryRoot, 'docs/plans/delivery.md'),
      '# Delivery\n\n<!-- > Status: Completed -->\n\n```md\n> Status: Completed\n```\n'
    )
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [{ path: 'docs/plans/delivery.md', status: 'completed', reviewedAt: '2026-08-31' }],
    }
    const index =
      '# Plans\n\n## Completed\n\n<!-- | [Delivery](./delivery.md) | Completed | -->\n'
    const errors = validatePlanRegistry(registry, { repositoryRoot, index }).join('\n')

    assert.match(errors, /does not index \.\/delivery\.md/)
    assert.match(errors, /delivery\.md must declare > Status: Completed/)
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('does not read a plan path that resolves outside docs/plans', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  const outsidePath = `${repositoryRoot}-outside.md`
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans'), { recursive: true })
    writeFileSync(outsidePath, '> Status: Completed\n')
    chmodSync(outsidePath, 0o000)
    const escapedPath = `docs/plans/../../../${path.basename(outsidePath)}`
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [{ path: escapedPath, status: 'completed', reviewedAt: '2026-08-31' }],
    }

    assert.doesNotThrow(() => validatePlanRegistry(registry, { repositoryRoot, index: '# Plans\n' }))
    assert.match(
      validatePlanRegistry(registry, { repositoryRoot, index: '# Plans\n' }).join('\n'),
      /must stay inside docs\/plans/
    )
  } finally {
    chmodSync(outsidePath, 0o600)
    rmSync(outsidePath, { force: true })
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})

test('rejects a plan entrypoint symlink that resolves outside docs/plans', () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'chatbox-plan-registry-'))
  try {
    mkdirSync(path.join(repositoryRoot, 'docs/plans/linked'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'outside-plan.md'), '# Outside\n\n> Status: Completed\n')
    symlinkSync('../../../outside-plan.md', path.join(repositoryRoot, 'docs/plans/linked/README.md'), 'file')
    const registry = {
      schemaVersion: 1,
      updatedAt: '2026-08-31',
      plans: [{ path: 'docs/plans/linked/README.md', status: 'completed', reviewedAt: '2026-08-31' }],
    }
    const index =
      '# Plans\n\n## Completed\n\n| Plan | Status |\n|---|---|\n| [Linked](linked/README.md) | Completed |\n'

    assert.match(
      validatePlanRegistry(registry, { repositoryRoot, index }).join('\n'),
      /must reference a regular plan file/
    )
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true })
  }
})
