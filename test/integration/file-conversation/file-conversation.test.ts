/**
 * File Conversation Integration Tests
 *
 * Tests AI models' ability to read files via tools (read_file, search_file_content)
 *
 * Usage:
 * 1. Set CHATBOX_LICENSE_KEY environment variable
 * 2. pnpm test:file-conversation
 *
 * Environment variables:
 * - CHATBOX_TEST_MODELS: comma-separated model list, e.g. "gpt-4o-mini,gpt-4o"
 * - CHATBOX_TEST_TIMEOUT: test timeout in ms (default: 120000)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPlatform, resetTestPlatform } from './setup'
import { runConversationTest as runTest, type TestFile, type TestResult } from './test-harness'

const LICENSE_KEY = process.env.CHATBOX_LICENSE_KEY || ''
const TEST_OUTPUT_DIR = path.join(__dirname, '../../../test/output/file-conversation')
const TEST_CASES_DIR = path.join(__dirname, '../../../test/cases/file-conversation')
const TEST_TIMEOUT = Number(process.env.CHATBOX_TEST_TIMEOUT) || 120000

const shouldSkip = !LICENSE_KEY

const DEFAULT_TEST_MODELS = [
  { provider: 'chatbox-ai', modelId: 'chatboxai-3.5', name: 'ChatboxAI 3.5' },
  { provider: 'chatbox-ai', modelId: 'chatboxai-4', name: 'ChatboxAI 4' },
  { provider: 'chatbox-ai', modelId: 'gpt-4o-mini', name: 'GPT-4o Mini (ChatboxAI)' },
  { provider: 'chatbox-ai', modelId: 'gpt-4o', name: 'GPT-4o (ChatboxAI)' },
  { provider: 'chatbox-ai', modelId: 'gpt-5-mini', name: 'GPT-5 Mini (ChatboxAI)' },
  { provider: 'chatbox-ai', modelId: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (ChatboxAI)' },
  { provider: 'chatbox-ai', modelId: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku (ChatboxAI)' },
  { provider: 'chatbox-ai', modelId: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (ChatboxAI)' },
]

function getTestModels() {
  const envModels = process.env.CHATBOX_TEST_MODELS
  if (!envModels) {
    return DEFAULT_TEST_MODELS
  }
  const modelIds = envModels.split(',').map((m) => m.trim())
  return DEFAULT_TEST_MODELS.filter((m) => modelIds.includes(m.modelId))
}

const TEST_MODELS = getTestModels()

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant that can read and analyze files.
When the user attaches files, use the provided tools (read_file, search_file_content) to access their content.
Always provide accurate and helpful responses based on the file content.
Be concise but thorough in your explanations.`

interface TestCase {
  name: string
  description: string
  files: string[]
  userMessage: string
  validate: (result: TestResult) => void
  timeout?: number
}

interface ModelTestResult {
  modelId: string
  modelName: string
  provider: string
  testCases: {
    name: string
    success: boolean
    error?: string
    duration: number
    toolCalls: string[]
    responsePreview?: string
  }[]
  summary: {
    total: number
    passed: number
    failed: number
    avgDuration: number
  }
}

interface TestReport {
  timestamp: string
  licenseKey: string
  models: ModelTestResult[]
  summary: {
    totalModels: number
    totalTests: number
    totalPassed: number
    totalFailed: number
    avgDuration: number
  }
}

function loadTestFile(fileName: string, fileType: string = 'text/plain'): TestFile {
  const filePath = path.join(TEST_CASES_DIR, fileName)
  const content = fs.readFileSync(filePath, 'utf-8')
  const storageKey = `test_file_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`
  return { storageKey, fileName, fileType, content }
}

function getFileType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  const typeMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.ts': 'text/typescript',
    '.js': 'text/javascript',
  }
  return typeMap[ext] || 'text/plain'
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Plain Text Q&A',
    description: 'Read a plain text file and answer questions about its content',
    files: ['sample.txt'],
    userMessage: 'Please read the attached file and tell me what is the User ID mentioned in it?',
    validate: (result) => {
      expect(result.toolCalls.length).toBeGreaterThan(0)
      expect(result.toolCalls.some((tc) => tc.toolName === 'read_file' || tc.toolName === 'search_file_content')).toBe(
        true
      )
      const responseText = getResponseText(result)
      expect(responseText).toContain('12345')
    },
  },
  {
    name: 'TypeScript Analysis',
    description: 'Read TypeScript code and explain its structure',
    files: ['sample.ts'],
    userMessage:
      'Please read the TypeScript file and explain what the Repository class does. What methods does it have?',
    validate: (result) => {
      expect(result.toolCalls.some((tc) => tc.toolName === 'read_file')).toBe(true)
      const responseText = getResponseText(result).toLowerCase()
      expect(responseText).toMatch(/add|get|delete|count/)
    },
  },
  {
    name: 'JSON Extraction',
    description: 'Read JSON data and extract specific information',
    files: ['sample.json'],
    userMessage:
      'Please read the JSON file and tell me: 1) How many users are there? 2) What is the name of the admin user?',
    validate: (result) => {
      const responseText = getResponseText(result)
      expect(responseText).toMatch(/3|three/i)
      expect(responseText).toMatch(/Alice/i)
    },
  },
  {
    name: 'Content Search',
    description: 'Use search_file_content to find specific patterns',
    files: ['sample.md'],
    userMessage:
      'Search the attached markdown file for "RATE_LIMITED" and explain what this error code means. You must use the search_file_content tool.',
    validate: (result) => {
      const usedTools = result.toolCalls.map((tc) => tc.toolName)
      expect(usedTools.some((t) => t === 'search_file_content')).toBe(true)
      const responseText = getResponseText(result).toLowerCase()
      expect(responseText).toMatch(/rate|limit|too many|429/)
    },
  },
  {
    name: 'Large File Handling',
    description: 'Handle large files with pagination',
    files: ['sample-large.txt'],
    userMessage:
      'The attached file is very large. Please read the first part and the last part. Tell me: 1) What is the title on line 1? 2) Read from line 600 onwards and find the end marker.',
    validate: (result) => {
      const readCalls = result.toolCalls.filter((tc) => tc.toolName === 'read_file')
      expect(readCalls.length).toBeGreaterThanOrEqual(1)
      const responseText = getResponseText(result)
      expect(responseText).toMatch(/Large Sample File|Pagination|testing/i)
    },
    timeout: 180000,
  },
  {
    name: 'Multi-File Analysis',
    description: 'Read and compare multiple files',
    files: ['sample.txt', 'sample.json'],
    userMessage:
      'I have attached two files: a text file and a JSON file. Please compare them and tell me if the API Key mentioned in the text file matches any configuration in the JSON file.',
    validate: (result) => {
      const readCalls = result.toolCalls.filter((tc) => tc.toolName === 'read_file')
      expect(readCalls.length).toBeGreaterThanOrEqual(2)
    },
    timeout: 180000,
  },
]

function getResponseText(result: TestResult): string {
  return (
    result.response?.contentParts
      ?.filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('') || ''
  )
}

function generateMarkdownReport(report: TestReport): string {
  const lines: string[] = []

  lines.push('# File Conversation Test Report')
  lines.push('')
  lines.push(`**Generated:** ${report.timestamp}`)
  lines.push(`**License Key:** ${report.licenseKey}`)
  lines.push('')

  lines.push('## Summary')
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Total Models | ${report.summary.totalModels} |`)
  lines.push(`| Total Tests | ${report.summary.totalTests} |`)
  lines.push(`| Passed | ${report.summary.totalPassed} |`)
  lines.push(`| Failed | ${report.summary.totalFailed} |`)
  lines.push(`| Pass Rate | ${((report.summary.totalPassed / report.summary.totalTests) * 100).toFixed(1)}% |`)
  lines.push(`| Avg Duration | ${report.summary.avgDuration.toFixed(0)}ms |`)
  lines.push('')

  lines.push('## Model Comparison')
  lines.push('')
  lines.push('| Model | Passed | Failed | Pass Rate | Avg Time |')
  lines.push('|-------|--------|--------|-----------|----------|')
  for (const model of report.models) {
    const passRate = ((model.summary.passed / model.summary.total) * 100).toFixed(0)
    lines.push(
      `| ${model.modelName} | ${model.summary.passed} | ${model.summary.failed} | ${passRate}% | ${model.summary.avgDuration.toFixed(0)}ms |`
    )
  }
  lines.push('')

  lines.push('## Test Case Results')
  lines.push('')

  const testCaseNames = [...new Set(report.models.flatMap((m) => m.testCases.map((tc) => tc.name)))]
  for (const testCaseName of testCaseNames) {
    lines.push(`### ${testCaseName}`)
    lines.push('')
    lines.push('| Model | Status | Duration | Tools Used |')
    lines.push('|-------|--------|----------|------------|')

    for (const model of report.models) {
      const tc = model.testCases.find((t) => t.name === testCaseName)
      if (tc) {
        const status = tc.success ? '✅ Pass' : '❌ Fail'
        const tools = tc.toolCalls.length > 0 ? tc.toolCalls.join(', ') : 'None'
        lines.push(`| ${model.modelName} | ${status} | ${tc.duration}ms | ${tools} |`)
      }
    }
    lines.push('')
  }

  const failures = report.models.flatMap((m) =>
    m.testCases
      .filter((tc) => !tc.success)
      .map((tc) => ({
        model: m.modelName,
        testCase: tc.name,
        error: tc.error,
      }))
  )

  if (failures.length > 0) {
    lines.push('## Failures')
    lines.push('')
    for (const f of failures) {
      lines.push(`### ${f.model} - ${f.testCase}`)
      lines.push('')
      lines.push('```')
      lines.push(f.error || 'Unknown error')
      lines.push('```')
      lines.push('')
    }
  }

  return lines.join('\n')
}

function generateHtmlReport(report: TestReport): string {
  const passRate = ((report.summary.totalPassed / report.summary.totalTests) * 100).toFixed(1)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>File Conversation Test Report</title>
  <style>
    :root {
      --bg: #1a1a2e;
      --card-bg: #16213e;
      --text: #eee;
      --muted: #888;
      --success: #4ade80;
      --error: #f87171;
      --border: #333;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { margin-bottom: 0.5rem; font-size: 2rem; }
    h2 { margin-top: 2rem; margin-bottom: 1rem; font-size: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    h3 { margin-top: 1.5rem; margin-bottom: 0.75rem; font-size: 1.1rem; }
    .meta { color: var(--muted); margin-bottom: 2rem; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .summary-card {
      background: var(--card-bg);
      padding: 1.5rem;
      border-radius: 8px;
      text-align: center;
    }
    .summary-card .value { font-size: 2rem; font-weight: bold; }
    .summary-card .label { color: var(--muted); font-size: 0.875rem; }
    .summary-card.success .value { color: var(--success); }
    .summary-card.error .value { color: var(--error); }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; background: var(--card-bg); border-radius: 8px; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: rgba(255,255,255,0.05); font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; }
    .status-pass { color: var(--success); }
    .status-fail { color: var(--error); }
    .progress-bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
    .progress-bar .fill { height: 100%; background: var(--success); }
    .tools { font-family: monospace; font-size: 0.85rem; color: var(--muted); }
    .failure-box { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--error); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .failure-box pre { white-space: pre-wrap; font-size: 0.85rem; color: var(--error); margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📂 File Conversation Test Report</h1>
    <div class="meta">
      <p>Generated: ${report.timestamp}</p>
      <p>License: ${report.licenseKey}</p>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="value">${report.summary.totalModels}</div>
        <div class="label">Models Tested</div>
      </div>
      <div class="summary-card">
        <div class="value">${report.summary.totalTests}</div>
        <div class="label">Total Tests</div>
      </div>
      <div class="summary-card success">
        <div class="value">${report.summary.totalPassed}</div>
        <div class="label">Passed</div>
      </div>
      <div class="summary-card error">
        <div class="value">${report.summary.totalFailed}</div>
        <div class="label">Failed</div>
      </div>
      <div class="summary-card">
        <div class="value">${passRate}%</div>
        <div class="label">Pass Rate</div>
      </div>
      <div class="summary-card">
        <div class="value">${report.summary.avgDuration.toFixed(0)}ms</div>
        <div class="label">Avg Duration</div>
      </div>
    </div>

    <h2>Model Comparison</h2>
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Pass Rate</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Avg Time</th>
        </tr>
      </thead>
      <tbody>
        ${report.models
          .map((m) => {
            const rate = ((m.summary.passed / m.summary.total) * 100).toFixed(0)
            return `
            <tr>
              <td><strong>${m.modelName}</strong></td>
              <td>
                <div class="progress-bar" style="width: 100px;">
                  <div class="fill" style="width: ${rate}%;"></div>
                </div>
                ${rate}%
              </td>
              <td class="status-pass">${m.summary.passed}</td>
              <td class="status-fail">${m.summary.failed}</td>
              <td>${m.summary.avgDuration.toFixed(0)}ms</td>
            </tr>
          `
          })
          .join('')}
      </tbody>
    </table>

    <h2>Test Case Details</h2>
    ${[...new Set(report.models.flatMap((m) => m.testCases.map((tc) => tc.name)))]
      .map((testCaseName) => {
        return `
        <h3>${testCaseName}</h3>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Tools Used</th>
            </tr>
          </thead>
          <tbody>
            ${report.models
              .map((model) => {
                const tc = model.testCases.find((t) => t.name === testCaseName)
                if (!tc) return ''
                const statusClass = tc.success ? 'status-pass' : 'status-fail'
                const statusIcon = tc.success ? '✅' : '❌'
                return `
                <tr>
                  <td>${model.modelName}</td>
                  <td class="${statusClass}">${statusIcon} ${tc.success ? 'Pass' : 'Fail'}</td>
                  <td>${tc.duration}ms</td>
                  <td class="tools">${tc.toolCalls.length > 0 ? tc.toolCalls.join(', ') : '-'}</td>
                </tr>
              `
              })
              .join('')}
          </tbody>
        </table>
      `
      })
      .join('')}

    ${
      report.models.some((m) => m.testCases.some((tc) => !tc.success))
        ? `
      <h2>Failures</h2>
      ${report.models
        .flatMap((m) =>
          m.testCases
            .filter((tc) => !tc.success)
            .map(
              (tc) => `
          <div class="failure-box">
            <strong>${m.modelName}</strong> - ${tc.name}
            <pre>${tc.error || 'Unknown error'}</pre>
          </div>
        `
            )
        )
        .join('')}
    `
        : ''
    }
  </div>
</body>
</html>`
}

describe('File Conversation Integration Tests', () => {
  const allResults: Map<string, { model: (typeof TEST_MODELS)[0]; results: TestResult[] }> = new Map()

  beforeAll(() => {
    if (shouldSkip) {
      console.warn('⚠️  CHATBOX_LICENSE_KEY not set, skipping integration tests')
      return
    }

    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true })
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log('File Conversation Integration Tests')
    console.log(`${'='.repeat(60)}`)
    console.log(`Testing ${TEST_MODELS.length} model(s): ${TEST_MODELS.map((m) => m.modelId).join(', ')}`)
    console.log(`Test cases: ${TEST_CASES.length}`)
  })

  beforeEach(() => {
    resetTestPlatform()
  })

  afterAll(() => {
    if (allResults.size === 0) return

    const modelResults: ModelTestResult[] = []
    let totalTests = 0
    let totalPassed = 0
    let totalDuration = 0

    for (const [, { model, results }] of allResults) {
      const testCases = results.map((r) => ({
        name: r.testName,
        success: r.success,
        error: r.error,
        duration: r.duration,
        toolCalls: r.toolCalls.map((tc) => tc.toolName),
        responsePreview: getResponseText(r).slice(0, 200),
      }))

      const passed = testCases.filter((tc) => tc.success).length
      const avgDuration = testCases.reduce((sum, tc) => sum + tc.duration, 0) / testCases.length

      modelResults.push({
        modelId: model.modelId,
        modelName: model.name,
        provider: model.provider,
        testCases,
        summary: {
          total: testCases.length,
          passed,
          failed: testCases.length - passed,
          avgDuration,
        },
      })

      totalTests += testCases.length
      totalPassed += passed
      totalDuration += testCases.reduce((sum, tc) => sum + tc.duration, 0)
    }

    const report: TestReport = {
      timestamp: new Date().toISOString(),
      licenseKey: LICENSE_KEY.slice(0, 8) + '...' + LICENSE_KEY.slice(-4),
      models: modelResults,
      summary: {
        totalModels: modelResults.length,
        totalTests,
        totalPassed,
        totalFailed: totalTests - totalPassed,
        avgDuration: totalDuration / totalTests,
      },
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    const jsonPath = path.join(TEST_OUTPUT_DIR, `report-${timestamp}.json`)
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))

    const mdPath = path.join(TEST_OUTPUT_DIR, `report-${timestamp}.md`)
    fs.writeFileSync(mdPath, generateMarkdownReport(report))

    const htmlPath = path.join(TEST_OUTPUT_DIR, `report-${timestamp}.html`)
    fs.writeFileSync(htmlPath, generateHtmlReport(report))

    console.log(`\n${'='.repeat(60)}`)
    console.log('Test Report Generated')
    console.log(`${'='.repeat(60)}`)
    console.log(`JSON: ${jsonPath}`)
    console.log(`Markdown: ${mdPath}`)
    console.log(`HTML: ${htmlPath}`)
    console.log(`\nSummary: ${totalPassed}/${totalTests} passed (${((totalPassed / totalTests) * 100).toFixed(1)}%)`)
  })

  for (const model of TEST_MODELS) {
    describe(`Model: ${model.name}`, () => {
      for (const testCase of TEST_CASES) {
        it.skipIf(shouldSkip)(
          testCase.name,
          async () => {
            const files = testCase.files.map((f) => loadTestFile(f, getFileType(f)))

            const result = await runTest({
              testName: testCase.name,
              files,
              userMessage: testCase.userMessage,
              licenseKey: LICENSE_KEY,
              systemPrompt: DEFAULT_SYSTEM_PROMPT,
              sessionSettings: {
                provider: model.provider,
                modelId: model.modelId,
              },
              platform: getTestPlatform(),
              validate: testCase.validate,
            })

            const key = `${model.provider}:${model.modelId}`
            if (!allResults.has(key)) {
              allResults.set(key, { model, results: [] })
            }
            allResults.get(key)!.results.push(result)

            if (result.success) {
              console.log(`    ✓ ${model.modelId}: ${testCase.name} (${result.duration}ms)`)
            } else {
              console.log(`    ✗ ${model.modelId}: ${testCase.name} - ${result.error}`)
            }

            expect(result.success).toBe(true)
          },
          testCase.timeout || TEST_TIMEOUT
        )
      }
    })
  }
})
