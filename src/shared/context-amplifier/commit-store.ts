/**
 * commit-store.ts — 已提交任务记忆的会话内存储
 *
 * 工具执行发生在会话流程里，压缩发生在若干轮之后，两者之间需要一个交接点。
 * 原设计（context-amp-mcp/lib/compress.js）通过 `options.taskMemories` 这个
 * Map 传递，这里同构。
 *
 * ## 关键时序：提交时该块还在 L0
 *
 * 模型在一个任务块的最后一个 assistant 轮次提交记忆，那一刻该块是**最新的**，
 * 也就是 L0（最近 2 块完整保留，不压缩）。等它随着对话推进降到 L1/L2/L3 才会
 * 被压缩——那可能是几轮之后。
 *
 * 所以认领必须在 L0 阶段就发生：块还在 L0 时把提交绑定到它的戳上，等它降层
 * 需要压缩时直接按戳取。曾经只在压缩分支里认领，结果一个都认领不到——压缩时
 * 提交早已被 clearPending 清掉。
 */

export interface CommittedMemory {
  /** 模型提交的原始 payload */
  payload: Record<string, unknown>
  /** 提交时该会话的消息数，用于认领时定位归属块 */
  messageCountAtCommit: number
  /** 本轮生成的 roundId（=目标消息 id），用于按轮次隔离 hasValidCommit 判定。 */
  roundId?: string
  /** 是否通过了结构校验。未通过的不进 L2，但保留用于诊断 */
  valid: boolean
  /** 校验错误，valid 为 true 时为空 */
  errors: string[]
  committedAt: number
}

/** sessionId → 该会话待认领的提交（按提交顺序） */
const pending = new Map<string, CommittedMemory[]>()
/** `${sessionId}:${stamp}` → 已绑定到该戳的提交。绑定后长期保留，供降层时取用。 */
const bound = new Map<string, CommittedMemory>()

function bindKey(sessionId: string, stamp: string): string {
  return `${sessionId}:${stamp}`
}

/** 记录一次提交。工具执行时调用。 */
export function recordCommit(
  sessionId: string,
  payload: Record<string, unknown>,
  messageCount: number,
  validation: { valid: boolean; errors: string[] },
  roundId?: string
): void {
  const list = pending.get(sessionId) ?? []
  list.push({
    payload,
    messageCountAtCommit: messageCount,
    valid: validation.valid,
    errors: validation.errors,
    roundId,
    committedAt: Date.now(),
  })
  pending.set(sessionId, list)
}

/**
 * 该会话本轮是否已有通过校验的提交。质量门用它判断能否放行 end_turn。
 *
 * @param roundId 本轮生成的 roundId。如果传了，只统计本轮的提交；
 *                不传则保留旧行为（统计全部 pending）。
 *
 * 不传时仍能返回 true，但会跟旧轮残留混淆——准备弃用时记得把 commit-gate 里的
 * 调用也改成必传。
 */
export function hasValidCommit(sessionId: string, roundId?: string): boolean {
  const list = pending.get(sessionId) ?? []
  return list.some((entry) => {
    if (!entry.valid) return false
    if (roundId !== undefined && entry.roundId !== roundId) return false
    return true
  })
}

/** 该会话最近一次提交的校验错误。用于生成补交指令。 */
export function lastCommitErrors(sessionId: string): string[] {
  const list = pending.get(sessionId) ?? []
  return list.at(-1)?.errors ?? []
}

/**
 * 把待认领的提交绑定到一个任务块的戳上。
 *
 * 在块还是 L0 时调用。绑定规则：取提交位置落在该块范围内的最后一次有效提交
 * ——补交回环可能产生多次提交，只有最终那次通过校验。
 *
 * @param blockStartIndex 块起始索引（含）
 * @param blockEndIndex 块结束索引（不含）
 */
export function bindCommitToBlock(
  sessionId: string,
  stamp: string,
  blockStartIndex: number,
  blockEndIndex: number
): void {
  const key = bindKey(sessionId, stamp)
  const list = pending.get(sessionId) ?? []
  let best: CommittedMemory | null = null
  for (const entry of list) {
    if (!entry.valid) continue
    // 提交发生在该块进行期间。用 > startIndex 而非 >=：提交必然在块的第一条
    // 用户消息之后（模型要先看到问题才能做事）。
    if (entry.messageCountAtCommit <= blockStartIndex) continue
    if (entry.messageCountAtCommit > blockEndIndex) continue
    best = entry
  }
  if (!best) return
  // 已绑定的不覆盖：块的记忆一旦确定就不该漂移，否则上下文里的摘要会在
  // 后续轮次悄悄变化。
  if (!bound.has(key)) bound.set(key, best)
}

/** 取该戳已绑定的提交。压缩时调用。 */
export function getBoundCommit(sessionId: string, stamp: string): CommittedMemory | null {
  return bound.get(bindKey(sessionId, stamp)) ?? null
}

/**
 * 清空该会话的待认领队列。每轮压缩结束后调用——已绑定的保留在 bound 里，
 * 未被任何块绑定的（校验失败的中间尝试）丢弃，避免 Map 随会话增长。
 */
export function clearPending(sessionId: string): void {
  pending.delete(sessionId)
}

/** 测试用：清空全部状态 */
export function resetCommitStore(): void {
  pending.clear()
  bound.clear()
}
