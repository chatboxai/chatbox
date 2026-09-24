/**
 * 质量门测试：模型想收尾时若未提交有效任务记忆，必须被拦回补交。
 *
 * 关键是不能卡死——有些模型会反复交出不合格的记录，超过上限必须放行，
 * 否则用户看到的是一个永远不回答的会话。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { evaluateCommitGate, resetCommitGate } from './commit-gate'
import { recordCommit, resetCommitStore } from '@shared/context-amplifier/commit-store'
import type { CommitConfig } from '@shared/context-amplifier/commit-config'

const config: CommitConfig = {
  toolName: 'commit_task_memory',
  description: '',
  parameters: {},
  requiredFields: ['task_goal'],
  notice: '',
  maxCorrectionAttempts: 3,
}

/** 只输出文本的步 = 模型想收尾 */
const textOnlyStep = { content: [{ type: 'text' }] }
/** 还在调工具的步 = 探索中 */
const toolStep = { content: [{ type: 'text' }, { type: 'tool-call', toolName: 'read_file' }] }

function gate(steps: object[], sessionId = 's1', roundId = 'r1') {
  return evaluateCommitGate(sessionId, roundId, { steps: steps as never, messages: [] }, config)
}

describe('质量门', () => {
  beforeEach(() => {
    resetCommitGate()
    resetCommitStore()
  })

  it('模型还在调工具时不干预', () => {
    expect(gate([toolStep]).injectSystem).toBeNull()
  })

  it('模型只输出文本且未提交 → 拦回补交', () => {
    const d = gate([toolStep, textOnlyStep])
    expect(d.injectSystem).toContain('commit_task_memory')
    expect(d.injectSystem).toContain('内部校验')
    expect(d.attempts).toBe(1)
  })

  it('已提交有效记忆 → 放行', () => {
    recordCommit('s1', { task_goal: 'x' }, 5, { valid: true, errors: [] })
    expect(gate([toolStep, textOnlyStep]).injectSystem).toBeNull()
  })

  it('补交指令带上上次的校验错误，模型才知道改什么', () => {
    recordCommit('s1', {}, 5, { valid: false, errors: ['evidence_fragments 至少包含一个紧凑证据片段'] })
    const d = gate([textOnlyStep])
    expect(d.injectSystem).toContain('evidence_fragments')
  })

  it('超过 3 次补交后放行，不卡死会话', () => {
    for (let i = 1; i <= 3; i++) {
      const d = gate([textOnlyStep])
      expect(d.injectSystem).not.toBeNull()
      expect(d.attempts).toBe(i)
    }
    // 第 4 次：放弃拦截
    const final = gate([textOnlyStep])
    expect(final.injectSystem).toBeNull()
  })

  it('不同轮次的补交计数互相隔离', () => {
    gate([textOnlyStep], 's1', 'r1')
    gate([textOnlyStep], 's1', 'r1')
    gate([textOnlyStep], 's1', 'r1')
    // r1 已用满，r2 应该从头开始
    const d = gate([textOnlyStep], 's1', 'r2')
    expect(d.injectSystem).not.toBeNull()
    expect(d.attempts).toBe(1)
  })

  it('提交成功后计数清零 —— 同轮次再收尾不会误拦', () => {
    gate([textOnlyStep])
    recordCommit('s1', { task_goal: 'x' }, 5, { valid: true, errors: [] })
    expect(gate([textOnlyStep]).injectSystem).toBeNull()
  })

  it('空步骤列表不干预（首步之前）', () => {
    expect(gate([]).injectSystem).toBeNull()
  })

  it('既无工具也无文本的步不算收尾意图', () => {
    expect(gate([{ content: [{ type: 'reasoning' }] }]).injectSystem).toBeNull()
  })

  it('补交指令明确禁止编造，并要求记录被否决方案', () => {
    const text = gate([textOnlyStep]).injectSystem ?? ''
    expect(text).toContain('不得编造')
    expect(text).toContain('被否决')
  })
})
