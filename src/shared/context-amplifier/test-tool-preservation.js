/**
 * 工具字段保全测试
 *
 * 验证核心不变量：**信息削减只允许发生在四层压缩里**。
 * 具体到长程任务，必须保证：
 *   1. 已完成的工具调用（state='result'）不被丢弃 —— 曾经 toTaskBlockMsg 只收
 *      state==='call'，把所有完成的调用在压缩前就扔了
 *   2. 工具结果不被截断 —— 曾经 contentPartsToText 对 result 做 .slice(0,200)
 *   3. 压缩 API 失败时，降级摘要仍带工具痕迹 —— 否则模型会重复执行已完成的探索
 *   4. StampStore 保留完整原文，可按戳召回
 *
 * 运行：node test-tool-preservation.js
 */

const { detectTaskBlocks, isUserRequest } = require('./task-block.js')
const { StampStore } = require('./stamp-store.js')

let failures = 0
const fail = (msg) => {
  console.error(`  FAIL: ${msg}`)
  failures++
}
const pass = (msg) => console.log(`  ok: ${msg}`)

// ── 复刻 pipeline.ts 的适配逻辑（保持与源文件一致） ──────────────────
function contentPartsToText(msg) {
  const parts = msg.contentParts ?? []
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text ?? ''
      if (p.type === 'tool-call') {
        const args = p.args === undefined ? '' : JSON.stringify(p.args)
        const res = p.result === undefined ? '' : ` => ${JSON.stringify(p.result)}`
        const errMark = p.state === 'error' ? ' [失败]' : ''
        return `工具调用 ${p.toolName}${args}${errMark}${res}`
      }
      if (p.type === 'reasoning') return p.text ? `[思考] ${p.text}` : ''
      return ''
    })
    .filter((s) => s.trim())
    .join('\n')
}

function toTaskBlockMsg(msg) {
  const parts = msg.contentParts ?? []
  const content = []
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
      content.push({ type: 'text', text: p.text })
    } else if (p.type === 'tool-call') {
      content.push({ type: 'tool_use', name: p.toolName, input: p.args })
      if (p.result !== undefined) {
        content.push({ type: 'tool_result', content: p.result, is_error: p.state === 'error' })
      }
    } else if (p.type === 'reasoning' && typeof p.text === 'string' && p.text.trim()) {
      content.push({ type: 'text', text: `[思考] ${p.text}` })
    }
  }
  return { role: msg.role, content: content.length ? content : '' }
}

function firstMeaningfulArg(args) {
  if (!args || typeof args !== 'object') return ''
  for (const key of ['path', 'file_path', 'command', 'query', 'pattern', 'name', 'url']) {
    const v = args[key]
    if (typeof v === 'string' && v.trim()) return v.length > 80 ? `${v.slice(0, 80)}…` : v
  }
  return ''
}

function summarizeResult(result) {
  if (typeof result === 'string') {
    const lines = result.split('\n').length
    return lines > 1 ? `${lines} 行` : `${result.length} 字符`
  }
  if (result && typeof result === 'object') {
    if (typeof result.totalLines === 'number') return `${result.totalLines} 行`
    if (typeof result.error === 'string') return '失败'
    if (Array.isArray(result.content)) return `${result.content.length} 项`
  }
  return '已完成'
}

function buildToolTrace(msgs) {
  const calls = []
  for (const msg of msgs) {
    for (const p of msg.contentParts ?? []) {
      if (p.type !== 'tool-call') continue
      const name = p.toolName ?? 'tool'
      const arg = firstMeaningfulArg(p.args)
      const outcome = p.state === 'error' ? '失败' : p.result === undefined ? '未完成' : summarizeResult(p.result)
      calls.push(arg ? `${name}(${arg}) → ${outcome}` : `${name} → ${outcome}`)
    }
  }
  return calls.join(' | ')
}

function buildFallbackSummary(block) {
  const trace = buildToolTrace(block.msgs)
  const lines = [block.summary]
  if (trace) lines.push(`#TOOLS ${trace}`)
  lines.push(`#NOTE 压缩未完成，完整原文可用 retrieve_by_stamp 按 #STAMP ${block.stamp} 召回`)
  return lines.join('\n')
}

// ── 构造含各种 state 的工具调用 ────────────────────────────────────
const BIG_RESULT = 'line\n'.repeat(500) // 远超旧的 200 字符截断

const messages = [
  { role: 'user', contentParts: [{ type: 'text', text: '请读取 auth.rs 并修复登录逻辑' }] },
  {
    role: 'assistant',
    contentParts: [
      { type: 'text', text: '我先读取文件。' },
      // 已完成：旧代码 state!=='call' 会整条丢弃
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'c1',
        toolName: 'read_file',
        args: { path: 'src/auth.rs' },
        result: BIG_RESULT,
      },
      // 失败的调用也必须留痕
      {
        type: 'tool-call',
        state: 'error',
        toolCallId: 'c2',
        toolName: 'edit_file',
        args: { path: 'src/auth.rs' },
        result: { error: 'sha mismatch' },
      },
      // 进行中
      { type: 'tool-call', state: 'call', toolCallId: 'c3', toolName: 'search_files', args: { pattern: 'login' } },
      { type: 'text', text: '登录逻辑在第 42 行，使用 bcrypt。' },
    ],
  },
  { role: 'user', contentParts: [{ type: 'text', text: '继续' }] },
  { role: 'assistant', contentParts: [{ type: 'text', text: '已完成修复。' }] },
]

console.log('=== 工具字段保全测试 ===\n')

// 1. 适配层是否保住所有 state
console.log('[1] 适配层不丢弃任何 state 的工具调用')
const adapted = messages.map(toTaskBlockMsg)
const toolUses = adapted.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'tool_use')
if (toolUses.length === 3) pass('3 个工具调用全部保留（result / error / call）')
else fail(`应保留 3 个工具调用，实际 ${toolUses.length}`)

const toolResults = adapted
  .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  .filter((c) => c.type === 'tool_result')
if (toolResults.length === 2) pass('2 个工具结果保留（含失败的）')
else fail(`应保留 2 个工具结果，实际 ${toolResults.length}`)

const errResult = toolResults.find((r) => r.is_error)
if (errResult) pass('失败调用被标记 is_error')
else fail('失败调用未标记 is_error')

// 2. 序列化不截断
console.log('\n[2] 序列化不截断工具结果')
const text = messages.map((m) => contentPartsToText(m)).join('\n')
// JSON.stringify 会把 \n 转义成 \\n，所以不能直接找原串；按长度判断是否被截断。
// 旧代码 .slice(0,200) 会让整段 text 远小于结果本身。
if (text.length > BIG_RESULT.length) pass(`完整结果进入压缩输入（${BIG_RESULT.length} 字符未被截断）`)
else fail(`工具结果被截断——压缩输入仅 ${text.length} 字符，小于结果本身 ${BIG_RESULT.length}`)

if (text.includes('[失败]')) pass('失败状态在压缩输入中可见')
else fail('失败状态未体现在压缩输入')

// 3. 任务块检测能看到工具
console.log('\n[3] 任务块检测识别工具调用')
const blocks = detectTaskBlocks(adapted, { l0Count: 999 })
if (blocks.length > 0) pass(`检测到 ${blocks.length} 个任务块`)
else fail('未检测到任务块')

const withTools = blocks.filter((b) => (b.meta?.toolCallsInBlock ?? 0) > 0)
if (withTools.length > 0) pass(`${withTools.length} 个块被识别为含工具调用`)
else fail('块的 meta.toolCallsInBlock 为 0——检测层看不到工具')

// 4. 降级摘要带工具痕迹（压缩失败时的保命机制）
console.log('\n[4] 压缩失败时降级摘要保留工具痕迹')
const b0 = { stamp: 'deadbeef1234', summary: '#TASK 请读取 auth.rs 并修复登录逻辑', msgs: messages }
const fb = buildFallbackSummary(b0)

if (fb.includes('#TOOLS')) pass('降级摘要含 #TOOLS 段')
else fail('降级摘要缺少 #TOOLS——模型会重复已完成的探索')

if (fb.includes('read_file')) pass('工具名可见（read_file）')
else fail('工具名丢失')

if (fb.includes('src/auth.rs')) pass('关键参数可见（文件路径）')
else fail('参数丢失，模型无法判断读过哪个文件')

if (fb.includes('501 行')) pass('结果规模可见（501 行）')
else fail(`结果规模缺失，实际内容: ${fb.slice(0, 200)}`)

if (fb.includes('失败')) pass('失败的调用被标注')
else fail('失败调用未标注，模型可能以为编辑成功了')

if (fb.includes('retrieve_by_stamp')) pass('提示可按戳召回完整原文')
else fail('未提示召回途径')

// 5. StampStore 无损
console.log('\n[5] StampStore 保留完整原文')
const store = new StampStore()
store.add(b0.stamp, messages, fb, 'done', { layer: 'L1', tokens: 999 })
const entry = store.get(b0.stamp)
if (entry && entry.fullMessages.length === messages.length) pass('原文消息数一致')
else fail('原文消息数不符')

const storedResult = entry.fullMessages
  .flatMap((m) => m.contentParts ?? [])
  .filter((p) => p.type === 'tool-call' && typeof p.result === 'string')
  .map((p) => p.result)
if (storedResult.some((r) => r.length === BIG_RESULT.length && r === BIG_RESULT)) {
  pass(`完整工具结果无损存档（${BIG_RESULT.length} 字符逐字节一致），可召回`)
} else {
  fail(`存档的工具结果不完整，实际长度 ${storedResult.map((r) => r.length).join(',')}`)
}

console.log(`\n=== ${failures === 0 ? '全部通过' : `${failures} 项失败`} ===`)
process.exit(failures === 0 ? 0 : 1)
