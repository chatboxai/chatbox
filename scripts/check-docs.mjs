#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), '..')
const markdownParser = unified().use(remarkParse)

const lifecycleStatuses = new Set([
  'proposed',
  'planned',
  'in-progress',
  'blocked',
  'completed',
  'superseded',
  'archived',
  'needs-triage',
])
const activeLifecycleStatuses = new Set(['proposed', 'planned', 'in-progress', 'blocked'])
const lifecycleLabels = {
  proposed: 'Proposed',
  planned: 'Planned',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
  superseded: 'Superseded',
  archived: 'Archived',
  'needs-triage': 'Needs triage',
}

function planIndexSection(status) {
  if (activeLifecycleStatuses.has(status)) return 'Active'
  if (status === 'completed') return 'Completed'
  if (status === 'superseded' || status === 'archived') return 'Archived'
  return 'Needs triage'
}

// Generated inventories and externally synchronized snapshots have their own
// source-of-truth workflows. Keep exclusions narrow and explain every one.
export const markdownScanExclusions = [
  {
    prefix: '.claude/skills/playwright-cli/',
    reason: 'externally synchronized skill snapshot whose reference bundle is not stored in this repository',
  },
  {
    path: 'docs/ui-inventory.md',
    reason: 'generated route and Storybook inventory maintained by scripts/generate-ui-inventory.mjs',
  },
]

function repositoryPath(repositoryRoot, relativePath) {
  return path.join(repositoryRoot, relativePath)
}

function isStrictIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function validateInstructionEntrypoints(errors, repositoryRoot) {
  const agentsPath = repositoryPath(repositoryRoot, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    errors.push('AGENTS.md is missing; it is the canonical coding-agent instruction entrypoint.')
  } else {
    const agentsStat = lstatSync(agentsPath)
    if (!agentsStat.isFile() || agentsStat.isSymbolicLink()) {
      errors.push('AGENTS.md must be a regular file so Chatbox workspace instruction loading can read it safely.')
    }
  }

  const claudePath = repositoryPath(repositoryRoot, 'CLAUDE.md')
  if (!existsSync(claudePath)) {
    errors.push('CLAUDE.md is missing; Claude Code needs it to import AGENTS.md.')
  } else if (readFileSync(claudePath, 'utf8').trim() !== '@AGENTS.md') {
    errors.push('CLAUDE.md must contain only @AGENTS.md so root instructions have one source of truth.')
  }
}

function isMarkdownScanExcluded(relativePath) {
  return markdownScanExclusions.some(
    (exclusion) => exclusion.path === relativePath || (exclusion.prefix && relativePath.startsWith(exclusion.prefix))
  )
}

export function trackedMarkdownFiles(repositoryRoot = defaultRepositoryRoot) {
  const output = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  return output
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => !isMarkdownScanExcluded(relativePath))
}

function blankNonNewlineCharacters(value) {
  return value.replace(/[^\n]/g, ' ')
}

function removeHtmlComments(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, blankNonNewlineCharacters)
}

function removeNonRenderedMarkdown(markdown) {
  const codeRanges = []
  visit(markdownParser.parse(markdown), (node) => {
    if (node.type !== 'code' && node.type !== 'inlineCode') return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) codeRanges.push({ start, end })
  })
  codeRanges.sort((left, right) => left.start - right.start)

  let visibleMarkdown = ''
  let sourceCursor = 0
  for (const range of codeRanges) {
    visibleMarkdown += markdown.slice(sourceCursor, range.start)
    visibleMarkdown += blankNonNewlineCharacters(markdown.slice(range.start, range.end))
    sourceCursor = range.end
  }
  visibleMarkdown += markdown.slice(sourceCursor)
  return removeHtmlComments(visibleMarkdown)
}

function appendRelativeTarget(targets, rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, '')
  if (
    target.startsWith('#') ||
    // Leading slash links in repository docs are application routes, not repository files.
    target.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(target) ||
    target.includes('{') ||
    target.includes('*')
  ) {
    return
  }
  const pathOnly = target.split('#', 1)[0].split('?', 1)[0]
  if (pathOnly) targets.push(pathOnly)
}

function relativeDocumentationTargets(markdown) {
  const targets = []
  visit(markdownParser.parse(markdown), (node) => {
    if (node.type === 'definition' && node.identifier.startsWith('^')) return
    if (['link', 'image', 'definition'].includes(node.type) && typeof node.url === 'string') {
      appendRelativeTarget(targets, node.url)
      return
    }
    if (node.type === 'html') {
      const htmlTagPattern = /<[a-z][^>]*>/gi
      for (const tagMatch of removeHtmlComments(node.value).matchAll(htmlTagPattern)) {
        const attributePattern = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
        for (const attributeMatch of tagMatch[0].matchAll(attributePattern)) {
          appendRelativeTarget(targets, attributeMatch[1] ?? attributeMatch[2] ?? attributeMatch[3])
        }
      }
    }
  })
  return targets
}

function relativeMarkdownLinks(markdown) {
  const tree = markdownParser.parse(markdown)
  const definitions = new Map()
  const links = []

  visit(tree, (node) => {
    if (node.type === 'definition' && !node.identifier.startsWith('^')) {
      definitions.set(node.identifier, node.url)
    }
  })
  visit(tree, (node) => {
    let rawTarget
    if (node.type === 'link') rawTarget = node.url
    if (node.type === 'linkReference') rawTarget = definitions.get(node.identifier)
    if (typeof rawTarget !== 'string') return

    const targets = []
    appendRelativeTarget(targets, rawTarget)
    if (targets.length === 1) {
      links.push({ target: targets[0], line: node.position?.start.line })
    }
  })
  return links
}

function resolveDocumentationTarget(sourcePath, encodedTarget) {
  try {
    return path.resolve(path.dirname(sourcePath), decodeURIComponent(encodedTarget))
  } catch {
    return undefined
  }
}

function pathContains(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function validateMarkdownLinks(errors, repositoryRoot, markdownFiles) {
  for (const relativeFile of markdownFiles) {
    const sourcePath = repositoryPath(repositoryRoot, relativeFile)
    const markdown = readFileSync(sourcePath, 'utf8')
    for (const encodedTarget of relativeDocumentationTargets(markdown)) {
      const resolvedTarget = resolveDocumentationTarget(sourcePath, encodedTarget)
      if (!resolvedTarget) {
        errors.push(`${relativeFile}: invalid URL encoding in Markdown link ${encodedTarget}`)
        continue
      }
      if (!pathContains(repositoryRoot, resolvedTarget)) {
        errors.push(`${relativeFile}: documentation link target leaves the repository ${encodedTarget}`)
        continue
      }
      if (!existsSync(resolvedTarget)) {
        errors.push(`${relativeFile}: missing documentation link target ${encodedTarget}`)
      }
    }
  }
}

function validateKnowledgeEntrypoints(errors, repositoryRoot) {
  const requiredPaths = [
    'docs/index.md',
    'docs/product/index.md',
    'docs/technical/index.md',
    'docs/plans/README.md',
    'docs/plans/TEMPLATE.md',
    'docs/plans/registry.json',
  ]
  for (const requiredPath of requiredPaths) {
    if (!existsSync(repositoryPath(repositoryRoot, requiredPath))) {
      errors.push(`Missing knowledge entrypoint: ${requiredPath}`)
    }
  }
}

function validateCategoryIndexes(errors, repositoryRoot) {
  for (const category of ['product', 'technical']) {
    const categoryDirectory = repositoryPath(repositoryRoot, `docs/${category}`)
    const indexPath = path.join(categoryDirectory, 'index.md')
    if (!existsSync(indexPath)) continue

    const indexedTargets = new Set(
      relativeMarkdownLinks(readFileSync(indexPath, 'utf8'))
        .map((link) => resolveDocumentationTarget(indexPath, link.target))
        .filter(Boolean)
    )
    const markdownFiles = readdirSync(categoryDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md')
      .map((entry) => entry.name)

    for (const markdownFile of markdownFiles) {
      if (!indexedTargets.has(path.join(categoryDirectory, markdownFile))) {
        errors.push(`docs/${category}/index.md does not index ./${markdownFile}`)
      }
    }
  }
}

function discoverPlanEntrypoints(errors, repositoryRoot) {
  const plansDirectory = repositoryPath(repositoryRoot, 'docs/plans')
  const entries = readdirSync(plansDirectory, { withFileTypes: true })
  const planPaths = []

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md') && !['README.md', 'TEMPLATE.md'].includes(entry.name)) {
      planPaths.push(path.posix.join('docs/plans', entry.name))
      continue
    }
    if (!entry.isDirectory()) continue

    const candidates = ['README.md', 'refactor-plan.md'].filter((candidate) =>
      existsSync(path.join(plansDirectory, entry.name, candidate))
    )
    if (candidates.length === 0) {
      errors.push(
        `docs/plans/${entry.name}/ must provide README.md or refactor-plan.md as its indexed plan entrypoint`
      )
      continue
    }
    if (candidates.length > 1) {
      errors.push(`docs/plans/${entry.name}/ has multiple plan entrypoints: ${candidates.join(', ')}`)
      continue
    }
    planPaths.push(path.posix.join('docs/plans', entry.name, candidates[0]))
  }

  return planPaths.sort()
}

function validatePlanPath(errors, repositoryRoot, value, location) {
  if (typeof value !== 'string' || !value.startsWith('docs/plans/') || path.isAbsolute(value)) {
    errors.push(`${location} must be a repository-relative path under docs/plans/`)
    return false
  }
  const plansDirectory = repositoryPath(repositoryRoot, 'docs/plans')
  const absolutePath = repositoryPath(repositoryRoot, value)
  if (!pathContains(plansDirectory, absolutePath)) {
    errors.push(`${location} must stay inside docs/plans/: ${value}`)
    return false
  }
  if (!existsSync(absolutePath)) {
    errors.push(`${location} does not reference a plan file: ${value}`)
    return false
  }
  const entryStat = lstatSync(absolutePath)
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
    errors.push(`${location} must reference a regular plan file: ${value}`)
    return false
  }
  if (!pathContains(realpathSync(plansDirectory), realpathSync(absolutePath))) {
    errors.push(`${location} must resolve inside docs/plans/: ${value}`)
    return false
  }
  return true
}

export function validatePlanRegistry(registry, { repositoryRoot = defaultRepositoryRoot, index } = {}) {
  const errors = []
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return ['docs/plans/registry.json must contain an object']
  }
  const allowedRegistryKeys = new Set(['schemaVersion', 'updatedAt', 'plans'])
  for (const key of Object.keys(registry)) {
    if (!allowedRegistryKeys.has(key)) errors.push(`docs/plans/registry.json contains unsupported field: ${key}`)
  }
  if (registry.schemaVersion !== 1) errors.push('docs/plans/registry.json schemaVersion must be 1')
  if (!isStrictIsoDate(registry.updatedAt)) {
    errors.push('docs/plans/registry.json updatedAt must be a valid YYYY-MM-DD date')
  }
  if (!Array.isArray(registry.plans)) {
    errors.push('docs/plans/registry.json plans must be an array')
    return errors
  }

  const expectedPlanPaths = discoverPlanEntrypoints(errors, repositoryRoot)
  const registryPaths = new Set()
  const registryPathList = []
  const indexMarkdown = index ?? readFileSync(repositoryPath(repositoryRoot, 'docs/plans/README.md'), 'utf8')
  const indexLines = removeNonRenderedMarkdown(indexMarkdown).split('\n')
  const indexPath = repositoryPath(repositoryRoot, 'docs/plans/README.md')
  const indexLinks = relativeMarkdownLinks(indexMarkdown).map((link) => ({
    ...link,
    resolvedTarget: resolveDocumentationTarget(indexPath, link.target),
  }))

  for (const [planIndex, plan] of registry.plans.entries()) {
    const location = `docs/plans/registry.json plans[${planIndex}]`
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      errors.push(`${location} must be an object`)
      continue
    }
    const allowedKeys = new Set(['path', 'status', 'owner', 'reviewedAt', 'supersededBy'])
    for (const key of Object.keys(plan)) {
      if (!allowedKeys.has(key)) errors.push(`${location} contains unsupported field: ${key}`)
    }

    const planPathIsValid = validatePlanPath(errors, repositoryRoot, plan.path, `${location}.path`)
    if (typeof plan.path === 'string') {
      if (registryPaths.has(plan.path)) errors.push(`Plan registry contains duplicate path: ${plan.path}`)
      registryPaths.add(plan.path)
      registryPathList.push(plan.path)
    }
    if (!lifecycleStatuses.has(plan.status)) errors.push(`${location}.status is invalid: ${plan.status}`)
    if (plan.owner !== undefined && (typeof plan.owner !== 'string' || plan.owner.length === 0)) {
      errors.push(`${location}.owner must be a non-empty string when provided`)
    }
    if (plan.supersededBy !== undefined) {
      validatePlanPath(errors, repositoryRoot, plan.supersededBy, `${location}.supersededBy`)
    }

    if (plan.status === 'needs-triage') {
      if (plan.owner !== undefined || plan.reviewedAt !== undefined || plan.supersededBy !== undefined) {
        errors.push(`${location} is Needs triage and must not claim reviewed lifecycle metadata`)
      }
    } else {
      if (!isStrictIsoDate(plan.reviewedAt)) errors.push(`${location}.reviewedAt must be a valid YYYY-MM-DD date`)
      if (activeLifecycleStatuses.has(plan.status) && (typeof plan.owner !== 'string' || plan.owner.length === 0)) {
        errors.push(`${location}.owner is required for active plans`)
      }
      if (plan.status === 'superseded' && typeof plan.supersededBy !== 'string') {
        errors.push(`${location}.supersededBy is required for superseded plans`)
      }
    }

    if (typeof plan.path === 'string' && lifecycleStatuses.has(plan.status)) {
      const relativeLink = `./${path.posix.relative('docs/plans', plan.path)}`
      const planAbsolutePath = repositoryPath(repositoryRoot, plan.path)
      const indexLink = indexLinks.find(
        (link) =>
          link.resolvedTarget === planAbsolutePath &&
          link.line !== undefined &&
          indexLines[link.line - 1]?.includes('|')
      )
      const indexLineNumber = indexLink?.line === undefined ? -1 : indexLink.line - 1
      if (indexLineNumber === -1) {
        errors.push(`docs/plans/README.md does not index ${relativeLink}`)
      } else {
        const indexLine = indexLines[indexLineNumber]
        if (!indexLine.includes(`| ${lifecycleLabels[plan.status]} |`)) {
          errors.push(`docs/plans/README.md must show ${lifecycleLabels[plan.status]} for ${relativeLink}`)
        }

        const sectionLine = indexLines
          .slice(0, indexLineNumber + 1)
          .reverse()
          .find((line) => line.startsWith('## '))
        const expectedSection = planIndexSection(plan.status)
        if (sectionLine !== `## ${expectedSection}`) {
          errors.push(`docs/plans/README.md must list ${relativeLink} under ## ${expectedSection}`)
        }
      }

      if (plan.status !== 'needs-triage' && planPathIsValid) {
        const planPath = repositoryPath(repositoryRoot, plan.path)
        const planMarkdown = removeNonRenderedMarkdown(readFileSync(planPath, 'utf8'))
        const statusMatch = planMarkdown.match(/^>\s*Status:\s*(.+?)\s*$/m)
        const documentStatus = statusMatch?.[1].replace(/[*_`]/g, '').trim()
        if (documentStatus !== lifecycleLabels[plan.status]) {
          errors.push(`${plan.path} must declare > Status: ${lifecycleLabels[plan.status]}`)
        }
      }
    }
  }

  for (const expectedPath of expectedPlanPaths) {
    if (!registryPaths.has(expectedPath)) errors.push(`Plan registry does not index ${expectedPath}`)
  }
  for (const registryPath of registryPathList) {
    if (!expectedPlanPaths.includes(registryPath)) errors.push(`Plan registry contains stale entry ${registryPath}`)
  }
  for (const plan of registry.plans) {
    if (plan?.status === 'superseded' && !registryPaths.has(plan.supersededBy)) {
      errors.push(`Superseded plan ${plan.path} references an unregistered replacement: ${plan.supersededBy}`)
    }
  }

  return errors
}

export function checkDocs(repositoryRoot = defaultRepositoryRoot) {
  const errors = []
  validateInstructionEntrypoints(errors, repositoryRoot)
  validateKnowledgeEntrypoints(errors, repositoryRoot)
  validateCategoryIndexes(errors, repositoryRoot)

  const registryPath = repositoryPath(repositoryRoot, 'docs/plans/registry.json')
  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
      errors.push(...validatePlanRegistry(registry, { repositoryRoot }))
    } catch (error) {
      errors.push(`docs/plans/registry.json is not valid JSON: ${error.message}`)
    }
  }

  const markdownFiles = trackedMarkdownFiles(repositoryRoot)
  validateMarkdownLinks(errors, repositoryRoot, markdownFiles)
  return { errors, markdownFileCount: markdownFiles.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const { errors, markdownFileCount } = checkDocs()
  if (errors.length > 0) {
    console.error(`Documentation checks failed (${errors.length}):`)
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log(`Documentation checks passed (${markdownFileCount} tracked Markdown files checked).`)
}
