/**
 * commit-gate.ts — 实时自报的质量门
 *
 * 目标：模型在给出最终答复之前，必须已经提交并通过 commit_task_memory 校验。
 * 这就是原设计（context-amp-mcp/lib/real-code-task-harness.js）的
 * "commit-correction-instruction" 回环，参数也沿用原值：最多 3 次补交。
 *
 * ## 为什么用 prepareStep 而不是 stopWhen
 *
 * `stopWhen` 只能让 SDK **提前停**，不能让它"不许停"——模型不调工具时 SDK 的
 * 多步循环自然结束，那时 stopWhen 已经无从干预。而 `prepareStep` 在每一步
 * 开始前被调用，能看到上一步的产物，也能覆写这一步的 messages。所以拦截点是：
 *
 *   模型上一步只输出文本（想收尾）且未提交有效记忆
 *        ↓  prepareStep 追加一条 system 消息要求补交
 *   模型这一步改为调用 commit_task_memory
 *        ↓  校验通过
 *   模型下一步给出最终答复，放行
 *
 * ## 为什么必须有次数上限
 *
 * 有些模型（或某些提示词组合）会反复交出不合格的记录。没有上限就会卡死在
 * 补交循环里，用户看到的是一个永远不回答的会话。超限后记为 fallback 放行，
 * L2 退回 curator 事后整理——降级，但不阻塞。
 */

import type { CommitConfig } from '@shared/context-amplifier/commit-config'
import { hasValidCommit, lastCommitErrors } from '@shared/context-amplifier/commit-store'

/** SDK 步骤的最小形状。只用到 content 里的 part 类型。 */
interface StepLike {
  content?: Array<{ type: string; toolName?: string }>
}

/** prepareStep 的最小入参形状 */
export interface GateInput {
  steps: StepLike[]
  messages: unknown[]
}

export interface GateDecision {
  /** 要追加的 system 消息文本，null 表示放行 */
  injectSystem: string | null
  /** 已用掉的补交次数 */
  attempts: number
}

/** 每个会话的补交计数。跨轮次保留会误判，所以按会话+轮次的组合重置。 */
const attemptCounters = new Map<string, number>()

function counterKey(sessionId: string, roundId: string): string {
  return `${sessionId}:${roundId}`
}

/** 一轮生成开始前清理该会话历史轮次的计数，保证 Map 按会话数有界。 */
export function clearSessionCommitGate(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of [...attemptCounters.keys()]) {
    if (key.startsWith(prefix)) attemptCounters.delete(key)
  }
}

/**
 * 判断这一步是否需要拦截。
 *
 * @param sessionId 会话 id
 * @param roundId 本轮生成的唯一标识（用目标消息 id），用于隔离补交计数
 */
export function evaluateCommitGate(
  sessionId: string,
  roundId: string,
  input: GateInput,
  config: CommitConfig
): GateDecision {
  const key = counterKey(sessionId, roundId)
  const attempts = attemptCounters.get(key) ?? 0

  // 已提交有效记忆：放行，并清掉计数
  if (hasValidCommit(sessionId)) {
    attemptCounters.delete(key)
    return { injectSystem: null, attempts }
  }

  const lastStep = input.steps.at(-1)
  if (!lastStep) return { injectSystem: null, attempts }

  const parts = lastStep.content ?? []
  const hasToolCall = parts.some((p) => p.type === 'tool-call')
  const hasText = parts.some((p) => p.type === 'text')

  // 上一步还在调工具：正常探索中，不干预
  if (hasToolCall) return { injectSystem: null, attempts }
  // 上一步既没工具也没文本：不是收尾意图，不干预
  if (!hasText) return { injectSystem: null, attempts }

  // 到这里：上一步只输出文本 = 想收尾，但没有有效提交
  if (attempts >= config.maxCorrectionAttempts) {
    console.warn(
      `[CommitGate] ${config.maxCorrectionAttempts} 次补交均未通过，放行并退回 curator 事后整理`
    )
    return { injectSystem: null, attempts }
  }

  attemptCounters.set(key, attempts + 1)
  const errors = lastCommitErrors(sessionId)
  return { injectSystem: buildCorrectionInstruction(config.toolName, errors), attempts: attempts + 1 }
}

/**
 * 补交指令。措辞要点来自原设计：
 * - 明确这是内部校验，不是用户要求
 * - 保留全部工具的正常循环（不要 toolChoice 强制，GLM 思考模式不支持）
 * - 只写已确认事实，不得编造——harness 从不代填字段
 */
function buildCorrectionInstruction(toolName: string, errors: string[]): string {
  const reason = errors.length
    ? `上一次提交被拒绝，原因：${errors.join('；')}。`
    : `本轮尚未调用并通过 ${toolName}。`
  return [
    '[内部校验]',
    reason,
    `请先调用 ${toolName} 提交本轮任务记忆，收到确认后再给出最终答复。`,
    '只写本轮工具和代码已确认的事实，不得编造；被否决的方案和失败原因同样要记录。',
    '本次工具调用属于内部协议，不要向用户复述。',
  ].join('\n')
}

/** 一轮生成结束后清理计数，避免 Map 无限增长。 */
export function clearCommitGate(sessionId: string, roundId: string): void {
  attemptCounters.delete(counterKey(sessionId, roundId))
}

/** 测试用 */
export function resetCommitGate(): void {
  attemptCounters.clear()
}
