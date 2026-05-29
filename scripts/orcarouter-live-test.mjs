#!/usr/bin/env node
/**
 * OrcaRouter live integration test.
 *
 * Drives the OrcaRouter HTTP API the same way the Chatbox `OrcaRouter`
 * model class does at runtime: OpenAI-compatible `/chat/completions`
 * against `https://api.orcarouter.ai/v1` with `HTTP-Referer` and `X-Title`
 * attribution headers.
 *
 * Get an API key at https://www.orcarouter.ai/console (format: sk-orca-...).
 *
 * Usage (bash / zsh):
 *   ORCAROUTER_API_KEY=sk-orca-xxx node scripts/orcarouter-live-test.mjs
 *
 * Usage (PowerShell on Windows):
 *   $env:ORCAROUTER_API_KEY = 'sk-orca-xxx'
 *   node scripts/orcarouter-live-test.mjs
 *
 * Usage (cmd.exe on Windows):
 *   set ORCAROUTER_API_KEY=sk-orca-xxx
 *   node scripts/orcarouter-live-test.mjs
 *
 * Covers:
 *   1. Non-stream chat with orcarouter/auto
 *   2. Streaming chat with openai/gpt-5.5
 *   3. Reasoning model (anthropic/claude-opus-4.7) — no temperature
 *   4. Invalid API key → 401 path
 *   5. Invalid model → error path
 *   6. /v1/models discovery endpoint
 */

const API_BASE = process.env.ORCAROUTER_API_BASE_URL || 'https://api.orcarouter.ai/v1'
const API_KEY = process.env.ORCAROUTER_API_KEY

if (!API_KEY) {
  console.error('ERROR: set ORCAROUTER_API_KEY (get one at https://www.orcarouter.ai/console)')
  process.exit(1)
}

const baseHeaders = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://www.orcarouter.ai/',
  'X-Title': 'Chatbox',
}

const results = []

function pass(name, info) {
  results.push({ name, ok: true, info })
  console.log(`PASS  ${name}${info ? ' — ' + info : ''}`)
}

function fail(name, err) {
  results.push({ name, ok: false, info: String(err) })
  console.log(`FAIL  ${name} — ${err}`)
}

async function chat({ model, messages, stream = false, extraBody = {} }) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ model, messages, stream, ...extraBody }),
  })
  return res
}

async function caseNonStream() {
  const name = '1. non-stream chat (orcarouter/auto)'
  try {
    const res = await chat({
      model: 'orcarouter/auto',
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content ?? ''
    pass(name, `model=${json.model || '?'}; reply="${text.trim().slice(0, 60)}"`)
  } catch (err) {
    fail(name, err.message || err)
  }
}

async function caseStream() {
  const name = '2. streaming chat (openai/gpt-5.5)'
  try {
    const res = await chat({
      model: 'openai/gpt-5.5',
      messages: [{ role: 'user', content: 'Count 1 to 3 separated by commas.' }],
      stream: true,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let chunks = 0
    let buffer = ''
    let collected = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunks++
      buffer += decoder.decode(value, { stream: true })
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const obj = JSON.parse(line.slice(6))
            collected += obj.choices?.[0]?.delta?.content ?? ''
          } catch {}
        }
      }
      buffer = buffer.endsWith('\n') ? '' : buffer.split('\n').pop()
    }
    if (chunks < 2) throw new Error(`only got ${chunks} chunk(s), expected stream`)
    pass(name, `chunks=${chunks}; collected="${collected.trim().slice(0, 60)}"`)
  } catch (err) {
    fail(name, err.message || err)
  }
}

async function caseReasoning() {
  const name = '3. reasoning model (anthropic/claude-opus-4.7) without temperature'
  try {
    const res = await chat({
      model: 'anthropic/claude-opus-4.7',
      messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content ?? ''
    pass(name, `reply="${text.trim().slice(0, 60)}"`)
  } catch (err) {
    fail(name, err.message || err)
  }
}

async function caseBadKey() {
  const name = '4. invalid API key → 401'
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...baseHeaders, Authorization: 'Bearer sk-orca-invalid-123' },
      body: JSON.stringify({
        model: 'orcarouter/auto',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    if (res.status === 401) {
      pass(name, `HTTP 401 as expected`)
    } else {
      fail(name, `expected 401, got ${res.status}`)
    }
  } catch (err) {
    fail(name, err.message || err)
  }
}

async function caseBadModel() {
  const name = '5. invalid model → error'
  try {
    const res = await chat({
      model: 'does-not-exist/model-x',
      messages: [{ role: 'user', content: 'hi' }],
    })
    if (!res.ok) {
      pass(name, `HTTP ${res.status} as expected`)
    } else {
      fail(name, `expected error, got 200`)
    }
  } catch (err) {
    fail(name, err.message || err)
  }
}

async function caseListModels() {
  const name = '6. GET /v1/models'
  try {
    const res = await fetch(`${API_BASE}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const count = Array.isArray(json.data) ? json.data.length : 0
    if (count === 0) throw new Error('empty data array')
    pass(name, `${count} models listed`)
  } catch (err) {
    fail(name, err.message || err)
  }
}

const cases = [caseNonStream, caseStream, caseReasoning, caseBadKey, caseBadModel, caseListModels]

console.log(`OrcaRouter live test — base=${API_BASE}`)
console.log('')
for (const c of cases) await c()
console.log('')
const passed = results.filter((r) => r.ok).length
console.log(`Summary: ${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
