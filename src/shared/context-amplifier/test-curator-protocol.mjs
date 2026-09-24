/**
 * curator 协议连通性测试
 *
 * 用一个临时 schema 验证 function-calling 链路：模型是否真的调用填字工具、
 * 参数能否解析、必填字段校验是否生效、缺字段时能否让模型修正后重提。
 *
 * 这里的 schema 是测试用的占位设计，与产品实际使用的 curator 配置无关——
 * 真实 schema 由 CTX_AMP_CURATOR 外部注入。
 *
 * 运行：CTX_AMP_KEY=... node test-curator-protocol.mjs
 */

const API = {
  endpoint: process.env.CTX_AMP_ENDPOINT || 'https://api.sfkey.cn/v1/chat/completions',
  apiKey: process.env.CTX_AMP_KEY || '',
  model: process.env.CTX_AMP_MODEL || 'glm-5.2',
}

if (!API.apiKey) {
  console.error('缺少 CTX_AMP_KEY')
  process.exit(1)
}

// 测试用占位 schema
const TOOL = {
  type: 'function',
  function: {
    name: 'submit_probe_memory',
    description: '提交任务块的结构化记录',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '任务目标' },
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              outcome: { type: 'string' },
            },
            required: ['action', 'outcome'],
          },
        },
        conclusion: { type: 'string' },
      },
      required: ['goal', 'steps', 'conclusion'],
    },
  },
}

const BLOCK_TEXT = `[USER]
读取 auth.rs 并修复登录逻辑

[ASSISTANT]
工具调用 read_file{"path":"src/auth.rs"} => 2104 行，登录逻辑在第 42 行，使用 bcrypt 校验
工具调用 edit_file{"path":"src/auth.rs"} [失败] => {"error":"sha mismatch"}
已定位问题：bcrypt cost 参数为 4，过低。`

let failures = 0
const pass = (m) => console.log(`  ok: ${m}`)
const fail = (m) => {
  console.error(`  FAIL: ${m}`)
  failures++
}

async function request(messages) {
  const res = await fetch(API.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API.apiKey}` },
    body: JSON.stringify({
      model: API.model,
      messages,
      tools: [TOOL],
      tool_choice: 'auto',
      temperature: 0,
      max_tokens: 16000,
    }),
  })
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 200) }
  const data = await res.json()
  const msg = data?.choices?.[0]?.message ?? {}
  return {
    ok: true,
    text: msg.content,
    toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    finishReason: data?.choices?.[0]?.finish_reason,
  }
}

console.log('=== curator function-calling 协议测试 ===\n')

console.log('[1] 模型是否调用填字工具')
const messages = [
  { role: 'system', content: '你是任务记忆整理助手。必须调用 submit_probe_memory 提交结构化记录，不要用自然语言回复。' },
  { role: 'user', content: `#TASK_BLOCK_BEGIN\n${BLOCK_TEXT}\n#TASK_BLOCK_END` },
]

const r1 = await request(messages)
if (!r1.ok) {
  fail(`请求失败 HTTP ${r1.status}: ${r1.body}`)
  console.log(`\n=== ${failures} 项失败（API 不可用，非协议问题）===`)
  process.exit(1)
}

if (r1.toolCalls.length > 0) pass(`返回 ${r1.toolCalls.length} 个 tool_calls`)
else fail(`未返回 tool_calls，finish_reason=${r1.finishReason}, content=${String(r1.text).slice(0, 120)}`)

const call = r1.toolCalls.find((c) => c.function?.name === TOOL.function.name)
if (call) pass(`调用了正确的工具名 ${TOOL.function.name}`)
else fail('工具名不匹配')

console.log('\n[2] 参数解析与 schema 遵守')
let payload = null
if (call) {
  try {
    payload = JSON.parse(call.function.arguments)
    pass('参数是合法 JSON')
  } catch (e) {
    fail(`参数 JSON 解析失败: ${e.message}`)
  }
}

if (payload) {
  const required = TOOL.function.parameters.required
  const missing = required.filter((f) => {
    const v = payload[f]
    return v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)
  })
  if (missing.length === 0) pass(`必填字段齐备（${required.join(', ')}）`)
  else fail(`缺少必填字段: ${missing.join(', ')}`)

  if (Array.isArray(payload.steps) && payload.steps.length > 0) {
    pass(`steps 是非空数组（${payload.steps.length} 项）`)
    const wellFormed = payload.steps.every((s) => s && typeof s.action === 'string' && typeof s.outcome === 'string')
    if (wellFormed) pass('steps 每项含 action + outcome')
    else fail('steps 项结构不符 schema')
  } else {
    fail('steps 不是非空数组')
  }

  console.log('\n[3] 是否捕捉到关键事实（含失败的工具调用）')
  const flat = JSON.stringify(payload)
  if (flat.includes('auth.rs')) pass('捕捉到文件名')
  else fail('未捕捉到文件名')
  if (/42|bcrypt/i.test(flat)) pass('捕捉到关键技术细节（行号或 bcrypt）')
  else fail('未捕捉到关键技术细节')
  if (/失败|mismatch|fail/i.test(flat)) pass('捕捉到失败的工具调用')
  else fail('未体现 edit_file 失败——模型可能以为编辑成功了')
}

console.log('\n[4] 校验失败后能否让模型修正重提')
const badMessages = [
  { role: 'system', content: '你是任务记忆整理助手。必须调用 submit_probe_memory。' },
  { role: 'user', content: '任务：测试。' },
  { role: 'assistant', content: null, tool_calls: call ? [call] : [] },
  {
    role: 'tool',
    tool_call_id: call?.id,
    content: '提交被拒绝，缺少或为空的字段：conclusion。请补全后重新调用。',
  },
]
const r2 = await request(badMessages)
if (r2.ok && r2.toolCalls.length > 0) pass('收到 tool 错误反馈后重新提交了工具调用')
else if (r2.ok) fail(`未重新提交（finish_reason=${r2.finishReason}）`)
else fail(`重提请求失败 HTTP ${r2.status}`)

console.log(`\n=== ${failures === 0 ? '全部通过' : `${failures} 项失败`} ===`)
process.exit(failures === 0 ? 0 : 1)
