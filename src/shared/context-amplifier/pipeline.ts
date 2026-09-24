/**
 * pipeline.ts — 上下文放大流水线（四层分级 + 远古区）
 *
 * 分层策略（按累计字节）：
 *   L0: 最后 2 轮，完整保留
 *   L1: 累计到 200KB，合并同类项（保留完整问答，工具链合箭头）
 *   L2: 累计到 384KB，提纯（提问要点+过程描述+结论精简）
 *   L3: 累计到 712KB，摘要（查询入口：主题/涉及/结论）
 *   ARCHIVE: 超过 712KB，不压缩，整块归档（为召回保留完整原文）
 *
 * 集成点（2026-08-24 更新）：builder.ts 中 applyCompaction + cleanToolCalls 之前。
 * 旧注释"applyMessageLimit 之后"已不准确——applyMessageLimit 在 builder.ts:76 被 hook 关掉，
 * 主 prompt 路径永不执行。本模块是 builder.ts 唯一会触发的上下文体积管理者。
 */

import { estimateTokens } from '../token-estimation/tokenizer'
import type { Message } from '../types'
import stampStoreCjs from './stamp-store.js'
// 这两个 .js 是 CommonJS（`module.exports = {...}`），而且被 Node 侧的
// MCP server 直接 require，不能改成 ESM——加 `export` 会让 Node 按 ES 模块
// 解析，内部的 require('crypto') 立刻失效。
//
// 但也不能用运行时 require()：Vite 不解析它，打包后渲染进程抛
// `require is not defined`，整个放大器失效。
//
// 默认导入是唯一同时满足两侧的形式：Rollup 的 CJS interop 会把
// module.exports 整体当作 default，Node 那边保持原样。
import taskBlockCjs from './task-block.js'

const taskBlock = taskBlockCjs as unknown as {
  detectTaskBlocks: (
    msgs: unknown[],
    opts: { l0Count: number }
  ) => Array<{
    stamp: string
    msgs: unknown[]
    status: 'pending' | 'done'
    summary: string
    meta?: Record<string, unknown>
  }>
  isUserRequest: (msg: unknown) => boolean
}

export const StampStore = (stampStoreCjs as unknown as { StampStore: unknown }).StampStore

import { bindCommitToBlock, clearPending, getBoundCommit } from './commit-store'
// ── L2 Curator 导入 ────────────────────────────────────────────────────
import { callCurator } from './curator-client'

// ── 最小类型声明 ───────────────────────────────────────────────────────
/** StampStore 实例只需 get / add 两个方法，不依赖 .d.ts 推断 */
export interface StampStoreLike {
  get(stamp: string): Record<string, unknown> | null
  add(stamp: string, fullMessages: unknown[], summary: string, status: string, meta?: Record<string, unknown>): void
  stamps(): string[]
}

export type CompressBlock = (
  systemPrompt: string,
  text: string,
  opts?: { timeout?: number }
) => Promise<{ ok: boolean; summary?: string }>

export interface ContextAmplifierOptions {
  /** StampStore 实例（调用方持有，跨请求复用） */
  store: StampStoreLike
  /** 压缩回调（可选）：不传则仅做任务块检测，不压缩 */
  compressBlock?: CompressBlock
  /** L0 轮次数（最近 N 轮完整保留），默认 2 */
  l0RoundCount?: number
  /** 消息数低于此阈值不触发放大，默认 2（测试期低阈值，便于观察分层行为） */
  minMessages?: number
  /** L1 累计上限（字节），默认 200KB */
  l1Threshold?: number
  /** L2 累计上限（字节），默认 384KB */
  l2Threshold?: number
  /** L3 累计上限（字节），默认 712KB */
  l3Threshold?: number
  /** 压缩超时 ms，默认 60000 */
  compressTimeout?: number
  /** 状态变更回调：压缩开始/结束时通知外部（如宿主应用） */
  onStateChange?: (state: 'idle' | 'working') => void
  /** 压缩情况回调：每轮分层结果，供宿主应用等可视化显示 */
  onReport?: (report: {
    totalBlocks: number
    compressedBlocks: number
    archivedBlocks: number
    fallbackBlocks: number
    cacheHits: number
    selfReportedBlocks: number
    /** L1 本地合并（不调 API）的块数。便于UI 压缩报告区分节省来源 */
    localMergedBlocks: number
    inputTokens: number
    /** 实际进入上下文的 token 总数（L0 原文 + L1/L2/L3 压缩块 + 透传消息） */
    compressedTokens: number
    layers: Array<{ layer: string; stamp: string; tokens: number }>
  }) => void
  /**
   * L2 结构化记忆（curator）的服务凭据。传入即启用——是否可用取决于
   * curator 配置是否存在（CTX_AMP_CURATOR），不需要额外的布尔开关。
   */
  curatorApi?: { endpoint: string; apiKey: string; model: string }
  /**
   * 会话 id。用于认领模型实时自报的任务记忆（commit_task_memory）。
   * 不传则跳过实时自报，L2 直接走 curator 事后整理。
   */
  sessionId?: string
  /**
   * 不得被压缩掉的消息 id。含其中任一 id 的任务块整块保持原样。
   *
   * 用于 compaction point 的 boundary / summary 消息：Chatbox 靠这两个 id
   * 在消息列表里定位 compaction 契约，id 消失会让它判定契约失效，进而把
   * summary 当孤儿删掉——那段历史就既没原文也没摘要了。
   */
  protectedMessageIds?: Set<string>
}

// ── 三套压缩提示词（分层梯度） ─────────────────────────────────────────
const PROMPT_L1 = `你是一个上下文合并助手。将以下对话块合并同类项，保留完整问答结构和关键结论。

规则：
- 保留用户的完整提问和助手的完整回答
- 工具调用链合并成箭头表示：Read(a.rs) → 2104行 → grep(error) → 3处
- 保留具体数据、文件名、错误信息、代码片段
- 删除重复探索、冗余确认、过程性对话
- 保持原始语言

输出格式：
用户：[完整问题]
助手：[完整回答] [工具链：A → B → C]
结论：[关键决策]`

const PROMPT_L2 = `你是一个上下文提纯助手。将以下对话块提炼成要点+过程+结论的精简形式。

规则：
- 提问要点：用户想解决什么问题
- 探索过程：检查了哪些文件/位置，发现了什么
- 关键结论：最终判断、数据、决策（保留具体值）
- 删除工具调用细节，只保留"在X中发现Y"
- 保持原始语言

输出格式：
#任务 [用户目标]
#过程 [检查了A/B/C，发现X]
#结论 [具体判断和数据]`

const PROMPT_L3 = `你是一个上下文摘要助手。将以下对话块压缩成查询入口（主题/涉及/结论）。

规则：
- 主题：一句话说明这个块在做什么
- 涉及范围：哪些文件、模块、概念（列表形式）
- 核心结论：最终判断（一句话，保留关键数据）
- 极度精简，只保留召回时能定位用的关键词
- 保持原始语言

输出格式：
#主题 [一句话]
#涉及 [文件A, 模块B, 概念C]
#结论 [一句话关键判断]`

// ── 适配层：Chatbox Message → task-block 格式 ─────────────────────────
/**
 * 序列化消息为压缩输入。不做任何截断——信息削减只允许发生在四层压缩里，
 * 在这一层截断等于绕过压缩偷偷丢信息，压缩模型看不到被砍掉的部分。
 */
function contentPartsToText(msg: Message): string {
  const parts = (msg as { contentParts?: Array<Record<string, unknown>> }).contentParts ?? []
  return parts
    .map((p) => {
      if (p.type === 'text') return (p.text as string) ?? ''
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

/** 将单条 Chatbox 消息转为 task-block 可识别格式 */
function toTaskBlockMsg(msg: Message) {
  // 历史消息可能是旧的扁平 content 形态；Message 类型只声明 contentParts，
  // 所以先过 unknown 再窄化，避免 TS 拒绝无重叠的断言。
  const legacyContent = (msg as unknown as { content?: unknown }).content
  if (typeof legacyContent === 'string') {
    return { role: msg.role, content: legacyContent }
  }
  const parts = (msg as { contentParts?: Array<Record<string, unknown>> }).contentParts ?? []
  const content: Array<Record<string, unknown>> = []
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
      content.push({ type: 'text', text: p.text })
    } else if (p.type === 'tool-call') {
      // state 取值为 'call' | 'result' | 'error' | 'paused'。必须全部纳入：
      // 只收 'call' 会把所有已完成的调用（'result'）丢在压缩之前，
      // 任务块看起来就"没有工具"，压缩层再怎么做也救不回来。
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

/** 消息列表 → 压缩文本 */
function toCompressText(msgs: Message[]): string {
  return msgs.map((m) => `[${m.role.toUpperCase()}]\n${contentPartsToText(m)}`).join('\n\n')
}

/**
 * 把 curator 提交的结构化记忆渲染成上下文文本。
 *
 * 不假设具体字段名——schema 由外部配置定义，这里按通用规则遍历：
 * 标量直接输出，数组逐项列出，嵌套对象展开一层。字段名原样作为标签，
 * 这样配置侧调整 schema 时无需改动本文件。
 */
function renderCuratedMemory(payload: Record<string, unknown>): string {
  const lines: string[] = []
  // working_state 由 appendWorkingState 单独渲染，这里跳过避免重复
  const skipKeys = new Set(['working_state'])
  for (const [key, value] of Object.entries(payload)) {
    if (skipKeys.has(key)) continue
    const rendered = renderValue(value)
    if (rendered) lines.push(`#${key} ${rendered}`)
  }
  return lines.join('\n')
}

function renderValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const items = value.map((item) => renderValue(item, depth + 1)).filter(Boolean)
    if (items.length === 0) return ''
    // 深层数组压成单行，避免结构化记忆本身占用过多上下文
    return depth === 0 ? `\n${items.map((s) => `  - ${s}`).join('\n')}` : items.join('；')
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const r = renderValue(v, depth + 1)
        return r ? `${k}: ${r}` : ''
      })
      .filter(Boolean)
    return parts.join('，')
  }
  return ''
}

/** 估算消息列表的 token 数（cl100k_base，与 Chatbox 的计数口径一致） */
function estimateBlockTokens(msgs: Message[]): number {
  return estimateTokens(toCompressText(msgs))
}

/**
 * 本地生成工具痕迹，零 API 依赖。
 *
 * 压缩 API 失败时（共享代理 503 很常见）原来只剩 `#TASK 用户问题`，助手做过
 * 什么完全丢失——模型会重新执行一遍已完成的探索，正是要解决的问题。这里保证
 * 即使压缩全线失败，"这件事做过、用了哪些工具、结果如何"仍在上下文里。
 */
function buildToolTrace(msgs: Message[]): string {
  const calls: string[] = []
  for (const msg of msgs) {
    const parts = (msg as { contentParts?: Array<Record<string, unknown>> }).contentParts ?? []
    for (const p of parts) {
      if (p.type !== 'tool-call') continue
      const name = (p.toolName as string) ?? 'tool'
      // 只取参数里最具定位价值的字段，避免降级摘要本身变得过长
      const arg = firstMeaningfulArg(p.args)
      const outcome = p.state === 'error' ? '失败' : p.result === undefined ? '未完成' : summarizeResult(p.result)
      calls.push(arg ? `${name}(${arg}) → ${outcome}` : `${name} → ${outcome}`)
    }
  }
  if (calls.length === 0) return ''
  return calls.join(' | ')
}

function firstMeaningfulArg(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const record = args as Record<string, unknown>
  for (const key of ['path', 'file_path', 'command', 'query', 'pattern', 'name', 'url']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.length > 80 ? `${value.slice(0, 80)}…` : value
    }
  }
  return ''
}

function summarizeResult(result: unknown): string {
  if (typeof result === 'string') {
    const lines = result.split('\n').length
    return lines > 1 ? `${lines} 行` : `${result.length} 字符`
  }
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>
    if (typeof record.totalLines === 'number') return `${record.totalLines} 行`
    if (typeof record.error === 'string') return '失败'
    if (Array.isArray(record.content)) return `${record.content.length} 项`
  }
  return '已完成'
}

// ── L1 本地合并同类项 ───────────────────────────────────────────────
/**
 * 不调 LLM 的 L1 合并：参考 pi-condense 成熟做法，以防御性硬代码保证
 * 结构完整性、角色交替正确性、内容可终结性。
 *
 * pi-condense 可借鉴点：
 * - 按“已完成工作单元”边界触发，而非每轮增量裁剪
 * - 工具链保留短 stub 形式，完整原文走召回
 * - 用硬代码判定边界与状态，而非让模型自由决定删什么
 *
 * 本实现强制满足：
 * - 所有路径必返回 1..2 条 user 角色消息，绝不返回空
 * - 当 user 提问为空时回退合并所有 text 内容
 * - contentParts 非空且含非空 text，保证 OpenAI 协议中不会出现空 user turn
 * - DONE/PENDING 通过 #STATUS 明确保留，#STAMP 与 #END_BLOCK 形成闭合块边界
 */
export const L1_BUILD_DIAGNOSTICS_SAMPLE_RATE = 5

export type L1HeaderBuildInfo = {
  stamp: string
  layer: 'L1'
  status: 'DONE' | 'PENDING'
  toolChain: string
  hasUserQuestions: boolean
}

function collectUserQuestions(block: LocatedBlock): string[] {
  const questions = block.msgs
    .filter((m) => m.role === 'user')
    .map((m) => extractTextContentParts([m]).join('').trim())
    .filter(Boolean)
  if (questions.length > 0) return questions
  const fallbackText = extractTextContentParts(block.msgs).join('\n').trim()
  return fallbackText ? [fallbackText.slice(0, 6000)] : []
}

function collectFinalConclusions(block: LocatedBlock): string[] {
  const conclusions: string[] = []
  for (let i = block.msgs.length - 1; i >= 0; i--) {
    const msg = block.msgs[i]
    if (msg.role !== 'assistant') continue
    const parts = (msg.contentParts ?? []) as Array<Record<string, unknown>>
    const text = parts
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('')
      .trim()
    if (text) conclusions.unshift(text)
    if (conclusions.length >= 2) break
  }
  return conclusions
}

function buildL1HeaderLines(info: L1HeaderBuildInfo): string[] {
  const lines: string[] = ['#STAMP ' + info.stamp, '#LAYER L1', '#STATUS ' + info.status]
  if (info.toolChain) lines.push('#TOOLS ' + info.toolChain)
  lines.push('#NOTE 完整原文可用 retrieve_by_stamp 按 #STAMP ' + info.stamp + ' 召回')
  lines.push('#END_BLOCK')
  return lines
}

function normalizeL1Text(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return normalized.length > 0 ? normalized : '[L1 合并内容为空，已保留原始块边界]'
}

export function buildL1MergedMessages(
  block: LocatedBlock,
  workingState?: WorkingState,
  curatedPayload?: Record<string, unknown>
): Message[] {
  const status: 'DONE' | 'PENDING' = block.status === 'pending' ? 'PENDING' : 'DONE'
  const toolChain = buildToolTrace(block.msgs)
  const userQuestions = collectUserQuestions(block)
  const conclusions = collectFinalConclusions(block)
  const mergedParts: string[] = []
  if (userQuestions.length > 0) mergedParts.push(userQuestions.map((q, i) => `[提问 ${i + 1}] ${q}`).join('\n'))
  if (conclusions.length > 0) mergedParts.push(conclusions.map((c, i) => `[结论 ${i + 1}] ${c}`).join('\n'))
  const workingStateText = workingState ? renderWorkingState(workingState).trim() : ''
  if (workingStateText) mergedParts.push(workingStateText)
  const curatedText = curatedPayload ? renderCuratedMemory(curatedPayload).trim() : ''
  if (curatedText) mergedParts.push(curatedText)
  let mergedBody = normalizeL1Text(mergedParts.join('\n\n'))
  if (mergedBody.length > 18000) mergedBody = mergedBody.slice(0, 18000) + '\n[已按 L1 长度保护截断]'
  const baseTimestamp = block.msgs.at(-1)?.timestamp ?? Date.now()
  const headerLines = buildL1HeaderLines({
    stamp: block.stamp,
    layer: 'L1',
    status,
    toolChain,
    hasUserQuestions: userQuestions.length > 0,
  })
  const fullText = [...headerLines.slice(0, -1), mergedBody, headerLines[headerLines.length - 1]].join('\n')
  return [
    {
      id: `stamp-${block.stamp}`,
      role: 'user' as const,
      timestamp: baseTimestamp,
      contentParts: [{ type: 'text' as const, text: fullText }],
    } as Message,
  ]
}

/**
 * 估算单条消息实际进入上下文的 token 数（cl100k_base，与 estimateBlockTokens 同口径）。
 *
 * L0 原文：contentParts 全量。L1/L2/L3 压缩块：只有 text part 会被发出去。
 * 早期实现按 `length × 1.2 / 4` 粗估，对中文（1 字符 ≈ 1.5~2 token）会低估
 * 5~7 倍，导致UI 压缩报告的 compressedTokens 与 inputTokens（真实 tiktoken）
 * 口径不一致，把 L1 仅 10~25% 的真实压缩显示成 90%+。统一走 estimateTokens。
 */
function estimateMessageTokens(msg: Message): number {
  const parts = (msg as { contentParts?: Array<{ type: string; text?: string }> }).contentParts ?? []
  let text = ''
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string') text += p.text
  }
  return Math.max(1, estimateTokens(text))
}

/**
 * chatbox 任务状态防御性兜底：模型自报的 working_state 即使在 LLM 压缩、
 * curator、整理失败三条路径都丢掉的情况下，也能被附加到摘要里——避免
 * 长程任务重复提出被否决的方案。
 */
type WorkingState = {
  current_goal?: string
  effective_decisions?: string[]
  rejected_decisions?: string[]
  architecture_boundaries?: string[]
  remaining_work?: string[]
}

function renderWorkingState(ws: WorkingState | undefined): string {
  if (!ws) return ''
  const lines: string[] = []
  if (typeof ws.current_goal === 'string' && ws.current_goal.trim()) {
    lines.push(`#GOAL ${ws.current_goal.trim()}`)
  }
  const listLines = (key: string, items: string[] | undefined) => {
    if (!Array.isArray(items) || items.length === 0) return
    const clean = items.map((s) => String(s).trim()).filter(Boolean)
    if (clean.length === 0) return
    lines.push(`#${key}`)
    for (const item of clean) lines.push(`- ${item}`)
  }
  listLines('EFFECTIVE', ws.effective_decisions)
  listLines('REJECTED', ws.rejected_decisions)
  listLines('BOUNDARY', ws.architecture_boundaries)
  listLines('REMAINING', ws.remaining_work)
  return lines.join('\n')
}

function appendWorkingState(summary: string, ws: WorkingState | undefined): string {
  const block = renderWorkingState(ws)
  if (!block) return summary
  if (summary.includes('\n#GOAL ') || summary.includes('\n#EFFECTIVE') || summary.includes('\n#REJECTED')) {
    return summary
  }
  return summary + '\n' + block
}

/**
 * 压缩失败时的降级摘要。纯本地拼接，永不失败。
 * 显式标注压缩状态，避免静默劣化——你在上下文里就能看出哪些块没压成。
 */
function buildFallbackSummary(
  block: { stamp: string; summary: string; msgs: Message[] },
  workingState?: WorkingState
): string {
  const trace = buildToolTrace(block.msgs)
  const lines = [block.summary]
  if (trace) lines.push(`#TOOLS ${trace}`)
  // working_state 兜底：即使压缩 API 全线失败，被否决方案也不要丢
  const ws = renderWorkingState(workingState)
  if (ws) lines.push(ws)
  lines.push(`#NOTE 压缩未完成，完整原文可用 retrieve_by_stamp 按 #STAMP ${block.stamp} 召回`)
  return lines.join('\n')
}

function getTextFromParts(parts: unknown): string | undefined {
  const arr = (parts ?? []) as Array<Record<string, unknown>>
  const found = arr.find((p) => p.type === 'text' && typeof p.text === 'string')
  return found ? String(found.text) : undefined
}

function buildL2FallbackStructuredText(block: LocatedBlock, workingState?: WorkingState): string {
  const goal = (() => {
    const userMsg = block.msgs.find((m) => m.role === 'user')
    const userText = userMsg ? getTextFromParts(userMsg.contentParts) : undefined
    return typeof userText === 'string' && userText.trim() ? userText.trim().slice(0, 600) : '未明确目标'
  })()
  const chain = buildToolTrace(block.msgs)
  const conclusion = (() => {
    for (let i = block.msgs.length - 1; i >= 0; i--) {
      const l2Text = getTextFromParts(block.msgs[i].contentParts)
      if (typeof l2Text === 'string' && l2Text.trim()) return l2Text.trim().slice(0, 800)
    }
    return '待补充结论'
  })()
  const lines = [
    `#任务 ${goal}`,
    chain ? `#因果链 ${chain}` : '#因果链 暂未形成可汇总链路',
    `#TOOLS ${chain || '无工具调用'} | retrieve_by_stamp #STAMP ${block.stamp} 可召回原文`,
    `#结论 ${conclusion}`,
    `#下一步 进一步核验当前块完成态与受影响文件`,
  ]
  const wsText = workingState ? renderWorkingState(workingState).trim() : ''
  if (wsText) lines.push(wsText)
  lines.push(`#证据片段 source=#STAMP ${block.stamp} fragment=块结构化保底 relevance=保底证据`)
  return lines.join('\n')
}

/**
 * 把压缩块渲染成一条上下文消息。
 *
 * 三个约定都来自原 MCP 实现（lib/compress.js 的 resultMessages 组装 +
 * lib/task-record.js 的 renderL1/renderRecord/renderQueryEntry），偏离任何一条
 * 都会破坏设计：
 *
 * 1. `role: 'user'`——压缩块是"系统交给模型的历史材料"，不是模型自己说过的话。
 *    标成 assistant 等于伪造模型发言，模型会把压缩摘要当成自己的结论继续推理；
 *    连续多个压缩块还会产生连续 assistant 消息，部分 API 要求角色交替。
 *
 * 2. 不设 `isSummary`。该标记在 Chatbox 里专指"compaction point 的替身"，
 *    builder.ts 的 applyCompaction 在没有 compaction point 时会执行
 *    `filter(m => !m.isSummary)`——压缩块会被整块删除，不是被压缩而是被清零，
 *    连 #STAMP 都不剩，召回彻底无从发起。
 *
 * 3. 结构化包裹 `#STAMP / #LAYER / #STATUS / … / #END_BLOCK`。原设计的
 *    STAMP_RECALL_NOTICE 要求模型"遵守 #STATUS：DONE 已结束，PENDING 尚未结束"，
 *    而 #END_BLOCK 给出明确边界，避免模型把相邻块的事实混在一起。
 */
function extractTextContentParts(msgs: Message[]): string[] {
  const texts: string[] = []
  for (const msg of msgs) {
    const parts = (msg.contentParts ?? []) as Array<Record<string, unknown>>
    for (const p of parts) {
      if (p.type === 'text' && typeof p.text === 'string') texts.push(String(p.text))
    }
  }
  return texts
}

function buildL3LocatorText(block: LocatedBlock, summary: string): string {
  const text = stripBlockMarkers(summary).trim()
  const topic = (() => {
    const firstLine = text.split('\n').find((line) => line.trim()) ?? ''
    return firstLine.slice(0, 160) || `块 ${block.stamp.slice(0, 8)}`
  })()
  const refs = (() => {
    const paths = Array.from(
      new Set(
        extractTextContentParts(block.msgs)
          .join('\n')
          .match(/[A-Za-z0-9_\-./\\]+\.(ts|js|tsx|jsx|md|json|rs|py|go|java)/g) ?? []
      )
    ).slice(0, 4)
    return paths.length > 0 ? paths.join(', ') : '见块内提及文件'
  })()
  const lines = [
    `摘要: ${topic}`,
    `召回路径: retrieve_by_stamp ${block.stamp} (scope=${block.layer === 'ARCHIVE' ? 'archive' : 'compressed'})`,
    `可获信息: 该块的原始对话、工具调用与结论原文`,
    `涉及: ${refs}`,
    `状态: ${block.status.toUpperCase()}`,
    text ? `内容要点: ${text.slice(0, 700)}` : '内容要点: 见召回原文',
  ]
  return lines.join('\n')
}

function renderBlockMessage(block: LocatedBlock, summary: string): Message {
  const normalizedSummary = block.layer === 'L3' ? buildL3LocatorText(block, summary) : summary
  const text = [
    `#STAMP ${block.stamp}`,
    `#LAYER ${block.layer}`,
    `#STATUS ${block.status.toUpperCase()}`,
    stripBlockMarkers(normalizedSummary),
    '#END_BLOCK',
  ].join('\n')

  return {
    id: `stamp-${block.stamp}`,
    role: 'user',
    timestamp: block.msgs.at(-1)?.timestamp ?? 0,
    contentParts: [{ type: 'text' as const, text }],
  } as Message
}

/**
 * 去掉正文里重复的头部标记。压缩模型常把 #STAMP/#STATUS 抄进输出，
 * 降级摘要本身也带一份（来自 task-block.js 的 summary 字段），
 * 不去重会在同一个块里出现两遍，模型可能读到矛盾的 #STATUS。
 */
function stripBlockMarkers(body: string): string {
  return body
    .replace(/^\s*#STAMP\s+\S+\s*$/gim, '')
    .replace(/^\s*#LAYER\s+L[0-3]\s*$/gim, '')
    .replace(/^\s*#STATUS\s+(?:DONE|PENDING)\s*$/gim, '')
    .replace(/^\s*#END_BLOCK\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── 核心：定位并分类任务块（按字节分层） ────────────────────────────
interface LocatedBlock {
  stamp: string
  startIdx: number
  endIdx: number
  msgs: Message[]
  status: 'pending' | 'done'
  summary: string
  layer: 'L0' | 'L1' | 'L2' | 'L3' | 'ARCHIVE'
  tokens: number
  /** 块内容哈希，用作压缩缓存键的一部分（戳只标识身份，块推进时戳不变） */
  contentHash: string
}

/**
 * TODO(goal-mode): 如果引入 goal 模式的块分组（一个 goal 跨多轮、含子任务），
 * L0 的语义会变：可能要把 L0 从"按 round 计数"改成"按 goal 切片"，
 * 且必须先切出 L0 再做字节累计。当前实现是"先按 round 给 L0，剩余按字节升层"，
 * goal 模式下这个顺序会让一个超大 goal 块直接进 L1 完整保留，撑爆上下文。
 * 届时参考 api加速的 "slice L0 first, then accumulate" 模式重写。
 */
function classifyBlocks(
  messages: Message[],
  l0RoundCount: number,
  l1Threshold: number,
  l2Threshold: number,
  l3Threshold: number,
  protectedMessageIds?: Set<string>
): LocatedBlock[] {
  const adapted = messages.map(toTaskBlockMsg)
  const rawBlocks = taskBlock.detectTaskBlocks(adapted, { l0Count: 999 }) // 先全检测，后面按字节分层

  const result: LocatedBlock[] = []
  let cursor = 0
  for (const b of rawBlocks) {
    while (cursor < adapted.length && !taskBlock.isUserRequest(adapted[cursor])) cursor++
    const len = b.msgs.length
    const blockMsgs = messages.slice(cursor, cursor + len)
    result.push({
      stamp: b.stamp,
      startIdx: cursor,
      endIdx: cursor + len,
      msgs: blockMsgs,
      status: b.status,
      summary: b.summary,
      layer: 'L0', // 临时，后面重分类
      tokens: estimateBlockTokens(blockMsgs),
      contentHash: (b.meta?.contentHash as string) ?? '',
    })
    cursor += len
  }

  // 按字节分层：从后往前累加
  const n = result.length
  let cumulative = 0
  let roundCount = 0

  for (let i = n - 1; i >= 0; i--) {
    cumulative += result[i].tokens

    // 含受保护消息的块整块留在 L0（不压缩），且不占 L0 轮次配额。
    //
    // 为什么必须整块保留，不能只让压缩块"继承" boundary 的 id：
    // applyCompaction 只用 boundaryIndex 做 slice，看起来继承 id 就够了。但
    // boundary 是 compaction 发生那一刻的最后一条消息（findLastCompactionBoundaryMessage），
    // 它可能是一条还没被回答的 user 消息——之后模型才回答，于是 boundary 位于
    // 块的**开头**而非末尾。此时若压缩块继承它的 id，slice(boundaryIndex+1)
    // 会连同 boundary 之后本该保留的 assistant 回答一起丢掉。整块保留则与
    // 原生行为完全一致（已实测对照）。
    //
    // 不占 L0 配额是有意的：受保护块的存在不该挤掉最近两轮的完整保留。
    // 代价是 boundary 之前的受保护块会被 applyCompaction 整块丢弃，那次
    // L0 保留白做了一遍——但它省下的是一次压缩 API 调用，不是上下文体积，
    // 而且原文仍进了 StampStore 可按戳召回。
    if (protectedMessageIds && result[i].msgs.some((m) => protectedMessageIds.has(m.id))) {
      result[i].layer = 'L0'
      continue
    }

    if (roundCount < l0RoundCount) {
      result[i].layer = 'L0'
      roundCount++
    } else if (cumulative <= l1Threshold) {
      result[i].layer = 'L1'
    } else if (cumulative <= l2Threshold) {
      result[i].layer = 'L2'
    } else if (cumulative <= l3Threshold) {
      result[i].layer = 'L3'
    } else {
      result[i].layer = 'ARCHIVE'
    }
  }

  return result
}

/**
 * 取该块此前压缩成功的摘要，没有则返回 null。
 *
 * 命中条件是三者同时满足：戳相同（同一任务块）、层相同（未跨层降级）、
 * 内容哈希相同（块未再推进）。任一不符都必须重压，否则上下文里会出现
 * 与实际历史不一致的摘要。
 */
function readCachedSummary(store: StampStoreLike, block: LocatedBlock): string | null {
  const entry = store.get(block.stamp)
  if (!entry) return null
  const meta = entry.meta as Record<string, unknown> | undefined
  if (!meta) return null
  if (meta.compressedLayer !== block.layer) return null
  if (meta.compressedHash !== block.contentHash) return null
  const summary = entry.summary
  return typeof summary === 'string' && summary.trim() ? summary : null
}

// ── 主入口 ─────────────────────────────────────────────────────────────
export async function amplifyContext(
  messages: Message[],
  options: ContextAmplifierOptions
): Promise<{
  messages: Message[]
  totalBlocks: number
  compressedBlocks: number
  archivedBlocks: number
  fallbackBlocks: number
  cacheHits: number
  selfReportedBlocks: number
  localMergedBlocks: number
  inputTokens: number
  layers: Array<{ layer: string; stamp: string; tokens: number }>
  compressedTokens: number
}> {
  const {
    store,
    compressBlock,
    l0RoundCount = 2,
    minMessages = 2,
    // 单位为 token，见 singleton.ts 的说明
    l1Threshold = 200_000,
    l2Threshold = 384_000,
    l3Threshold = 712_000,
    compressTimeout = 60000,
    curatorApi,
    sessionId,
    protectedMessageIds,
  } = options

  const emptyReport = {
    totalBlocks: 0,
    compressedBlocks: 0,
    archivedBlocks: 0,
    fallbackBlocks: 0,
    cacheHits: 0,
    selfReportedBlocks: 0,
    localMergedBlocks: 0,
    inputTokens: 0,
    compressedTokens: 0,
    layers: [] as Array<{ layer: string; stamp: string; tokens: number }>,
  }

  if (messages.length < minMessages) return { messages, ...emptyReport }

  const blocks = classifyBlocks(messages, l0RoundCount, l1Threshold, l2Threshold, l3Threshold, protectedMessageIds)
  if (!blocks.length) return { messages, ...emptyReport }

  // 构建 "消息索引 → 所属块" 映射，供单次遍历使用
  const blockOf = new Map<number, LocatedBlock>()
  for (const b of blocks) for (let i = b.startIdx; i < b.endIdx; i++) blockOf.set(i, b)

  const output: Message[] = []
  let compressedCount = 0
  let archivedCount = 0
  // 压缩失败、退回本地降级摘要的块数。暴露出来是为了让失败可见——
  // 静默劣化会让长程任务在你不知情的情况下退化。
  let fallbackCount = 0
  // 缓存命中数：省下的 API 调用次数。为 0 而块数很多时说明缓存没生效。
  let cacheHitCount = 0
  // 用模型实时自报记录的块数。这是保真度最高的来源，为 0 说明质量门没生效。
  let selfReportCount = 0
  // L1 本地合并块数。L1 走本地不调 API，调 API 次数 = compressedBlocks
  // - selfReportedBlocks - localMergedBlocks。
  let localMergedCount = 0
  const done = new Set<string>()
  const { onStateChange } = options

  // 通知开始工作
  if (compressBlock && blocks.some((b) => b.layer !== 'L0' && b.layer !== 'ARCHIVE')) {
    onStateChange?.('working')
  }

  try {
    for (let i = 0; i < messages.length; i++) {
      const b = blockOf.get(i)
      if (!b) {
        output.push(messages[i])
        continue
      } // 非块消息：透传
      if (done.has(b.stamp)) continue // 已处理过的块：跳过
      done.add(b.stamp)

      // 绑定实时自报，对所有层统一执行，且必须在分层判断之前。
      //
      // 时序原因：模型在块的最后一个 assistant 轮次提交记忆，那一刻该块是最新的
      // ——也就是 L0（不压缩）。等它降到 L1/L2/L3 才需要压缩，而那时 pending
      // 队列早已被 clearPending 清空。所以绑定不能放在压缩分支里。
      //
      // 不放在 L0 分支里也是有意的：会话恢复或首次构建时，一个块可能一上来就
      // 处于 L1/L2/L3，从没经过本进程的 L0 阶段；bindCommitToBlock 内部对没有
      // 匹配提交的情况是空操作，统一调用不会有副作用。
      if (sessionId) bindCommitToBlock(sessionId, b.stamp, b.startIdx, b.endIdx)

      if (b.layer === 'L0') {
        // L0：完整保留 + 轻量级协议头。让 L0→L1 切换时模型已经认识协议，
        // 不会跨阈值时面对突然出现的 #STAMP/#STATUS 感到陌生。
        // 协议头 role=user：和 L1/L2/L3 渲染块一致，模型按"系统注入的历史材料"读。
        const protocolHeader = {
          id: `stamp-${b.stamp}-proto`,
          role: 'user' as const,
          timestamp: b.msgs.at(-1)?.timestamp ?? 0,
          contentParts: [
            {
              type: 'text' as const,
              text: [`#STAMP ${b.stamp}`, '#LAYER L0', `#STATUS ${b.status.toUpperCase()}`, '#END_BLOCK'].join('\n'),
            },
          ],
        } as Message
        output.push(protocolHeader, ...b.msgs)
        // 戳现在是稳定的（基于块身份），所以每轮都要 add 一次让 store 跟上
        // 块的推进。add 内部只在内容增长时覆盖，不会回退。
        store.add(b.stamp, b.msgs, b.summary, b.status, { layer: 'L0', tokens: b.tokens })
      } else if (b.layer === 'ARCHIVE') {
        // 远古区：只存档，不进上下文，不压缩
        store.add(b.stamp, b.msgs, b.summary, b.status, { layer: 'ARCHIVE', tokens: b.tokens })
        archivedCount++
        // 不生成输出消息
      } else if (b.layer === 'L1') {
        // L1：本地合并同类项。不调 LLM、不查缓存、不走自报/curator。
        // 理由见 buildL1MergedMessages 上面的注释：PROMPT_L1 要求"保留完整
        // 问答 + 工具链"，是确定性结构化操作；走 LLM 反而被模型压成短摘要。
        //
        // 但 working_state 自报仍然要附加：模型在块最后一个 assistant 轮次
        // 提交的工作状态（current_goal / effective_decisions / ...）即使没
        // 调 LLM 摘要也应该出现在 L1 块里——它是被否决方案的关键载体。
        const committedL1 = sessionId ? getBoundCommit(sessionId, b.stamp) : null
        const workingStateL1 = (committedL1?.payload?.working_state as WorkingState | undefined) ?? undefined
        const merged = buildL1MergedMessages(b, workingStateL1, committedL1?.payload)
        output.push(...merged)
        // store 仍要写：层降级时（l1 → l2）若再调到这块，旧 compressedHash
        // 不匹配会强制重压。同时让 StampStore 跟上块的推进。
        store.add(b.stamp, b.msgs, '[L1 本地合并]', b.status, {
          layer: 'L1',
          tokens: b.tokens,
        })
        // L1 走本地不调 API。"自报" (workingState + curatedPayload) 进 L1
        // 合并块并计 selfReportCount——commit 落 L1 块时，模型在那个块
        // 提交的工作状态被本地合并消费并保留。
        compressedCount++
        localMergedCount++
        if (committedL1) selfReportCount++
      } else {
        // L1/L2/L3：压缩。先取 working_state，三条路径都强制附加到结果里。
        const committed = sessionId ? getBoundCommit(sessionId, b.stamp) : null
        const workingState = (committed?.payload?.working_state as WorkingState | undefined) ?? undefined

        // 缓存命中的摘要可能不含 working_state（缓存只存 summary 文本），
        // 此变量记录"模型自报那份"以保证最终 output 一定带。
        const selfReportWs = workingState

        let summary = buildFallbackSummary(b, workingState)
        let compressed = false

        // 先查缓存。上下文在每轮对话都会重建一次，而已完成的历史块内容不再
        // 变化——不查缓存等于每轮把所有 L1/L2/L3 块重新压一遍，N 个块就是
        // 每轮 N 次串行网络请求，既慢又是 429/503 的主要来源。
        //
        // 缓存键含 layer 和 contentHash：块跨层降级（L1→L2）必须重压，
        // 块内容推进（同一戳追加了新消息）也必须重压。
        const cached = readCachedSummary(store, b)
        if (cached) {
          summary = appendWorkingState(cached, selfReportWs)
          compressed = true
          cacheHitCount++
        }

        // 三级降级，对齐原设计 compress.js 的 curatedRecords 优先级：
        //   1. 模型实时自报（commit_task_memory）—— 最优
        //   2. curator 事后整理 —— 次优
        //   3. 本地降级摘要（含工具痕迹）—— 兜底
        //
        // 实时自报优先的理由：模型写最终回答那一刻知道自己为什么否决了某个
        // 方案、哪一步失败及原因。事后让 curator 读历史只能推断这些因果，而且
        // 容易把"被否决的方案"当噪音删掉——那恰好是防重复踩坑的关键。
        if (!compressed && committed) {
          // renderCuratedMemory 已排除 working_state 字段，避免和下面的
          // appendWorkingState 重复渲染。
          summary = appendWorkingState(renderCuratedMemory(committed.payload), selfReportWs)
          compressed = true
          selfReportCount++
        }

        // 压缩顺序：L2 走结构化记忆（curator，function-calling 协议），失败则
        // 退到该层的简单压缩；两者都失败保留上面的降级摘要（含工具痕迹）。
        // 扁平化写法避免嵌套 try/catch 里遗漏某条分支的降级处理。
        if (!compressed && b.layer === 'L2' && curatorApi) {
          try {
            const curated = await callCurator(toCompressText(b.msgs), b.stamp, {
              ...curatorApi,
              timeout: compressTimeout,
            })
            if (curated.ok && curated.payload) {
              // curator 可能填了 working_state，优先用它的；否则用模型自报
              const curatedWs = (curated.payload?.working_state as WorkingState | undefined) ?? selfReportWs
              summary = appendWorkingState(renderCuratedMemory(curated.payload), curatedWs)
              compressed = true
            } else if (curated.error) {
              console.warn(`[Curator] ${b.stamp} 结构化整理失败（${curated.error}），退到简单压缩`)
            }
          } catch (error) {
            console.warn('[Curator] 调用异常，退到简单压缩:', error instanceof Error ? error.message : error)
          }
        }

        if (!compressed && b.layer === 'L2' && compressBlock) {
          try {
            const l2Summary = buildL2FallbackStructuredText(b, selfReportWs)
            const r = await compressBlock(
              PROMPT_L2,
              `必须调用结构化工具，禁止自由总结。\n${toCompressText(b.msgs)}\n\n结构化保底摘要：\n${l2Summary}`,
              {
                timeout: compressTimeout,
              }
            )
            if (r.ok && r.summary) {
              const refined = stripBlockMarkers(r.summary).trim()
              summary = appendWorkingState(refined ? refined : l2Summary, selfReportWs)
              compressed = true
            }
          } catch {
            /* 保留降级摘要（fallback），本次压缩记为失败，下轮重试 */
          }
        }

        if (!compressed && b.layer === 'L3' && compressBlock) {
          try {
            const prompt = PROMPT_L3
            const r = await compressBlock(prompt, toCompressText(b.msgs), { timeout: compressTimeout })
            if (r.ok && r.summary) {
              summary = appendWorkingState(r.summary, selfReportWs)
              compressed = true
            }
          } catch {
            /* 保留降级摘要 */
          }
        }

        if (compressed) {
          compressedCount++
        } else {
          fallbackCount++
        }

        // 只有压缩成功才写 compressedLayer/compressedHash，降级摘要不进缓存——
        // 否则一次 API 故障会被永久固化，后续轮次再也不会重试压缩。
        store.add(b.stamp, b.msgs, summary, b.status, {
          layer: b.layer,
          tokens: b.tokens,
          ...(compressed ? { compressedLayer: b.layer, compressedHash: b.contentHash } : {}),
        })
        output.push(renderBlockMessage(b, summary))
      }
    }
  } finally {
    // 无论成功或失败，都通知回到空闲状态
    onStateChange?.('idle')
    // 清空待认领队列：已被块认领的提交留在 claimed 里，未被认领的（校验失败的
    // 中间尝试）丢弃，避免 Map 随会话增长。
    if (sessionId) clearPending(sessionId)
  }

  // 实际发给 LLM 的 token 数（output 里所有消息的字符数粗估）。
  // 注意 ARCHIVE 块不进 output（pipeline.ts:586），所以这里只算 L0 + L1/L2/L3 + 透传。
  const compressedTokens = output.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
  const report = {
    totalBlocks: blocks.length,
    compressedBlocks: compressedCount,
    archivedBlocks: archivedCount,
    fallbackBlocks: fallbackCount,
    cacheHits: cacheHitCount,
    selfReportedBlocks: selfReportCount,
    localMergedBlocks: localMergedCount,
    inputTokens: blocks.reduce((sum, b) => sum + b.tokens, 0),
    compressedTokens,
    layers: blocks.map((b) => ({ layer: b.layer, stamp: b.stamp, tokens: b.tokens })),
  }
  if (fallbackCount > 0) {
    console.warn(`[ContextAmplifier] ${fallbackCount}/${blocks.length} 块压缩失败，已用本地降级摘要（保留工具痕迹）`)
  }
  options.onReport?.(report)

  return { messages: output, ...report }
}
