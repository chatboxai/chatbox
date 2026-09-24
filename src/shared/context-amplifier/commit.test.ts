/**
 * 实时自报（commit_task_memory）的校验与质量门测试。
 *
 * 覆盖重点是"形状合法但没信息"这类提交——`causal_steps: [{}]` 满足数组非空，
 * 却什么都没记。原设计因此逐项检查子字段，这里守住那条下限。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { validateCommitPayload } from './commit-validator'
import {
  bindCommitToBlock,
  clearPending,
  getBoundCommit,
  hasValidCommit,
  lastCommitErrors,
  recordCommit,
  resetCommitStore,
} from './commit-store'

const REQUIRED = [
  'task_goal',
  'causal_steps',
  'key_facts',
  'evidence',
  'evidence_fragments',
  'conclusion',
  'open_items',
  'next_action',
  'working_state',
]

/** 一份合格的提交 */
function validPayload() {
  return {
    task_goal: '重构认证模块的密码哈希逻辑',
    causal_steps: [
      { intent: '了解现有实现', tool_action: 'read_file auth.rs', result: '2104 行，第 42 行用 bcrypt' },
      { intent: '确认调用方', tool_action: 'grep verify', result: '3 处命中' },
      { intent: '尝试提升 cost', tool_action: 'edit auth.rs cost=16', result: '失败：sha mismatch' },
    ],
    key_facts: ['auth.rs:42 使用 bcrypt', '最终采用 cost=12'],
    evidence: ['auth.rs:42：bcrypt::hash(pw, DEFAULT_COST)'],
    evidence_fragments: [
      {
        source: 'auth.rs:42',
        fragment: 'bcrypt::hash(password, DEFAULT_COST) — DEFAULT_COST 当前为 12',
        relevance: '决定了后续 cost 调整的基线',
      },
    ],
    conclusion: '保持 cost=12，cost=16 因编辑冲突未采用',
    open_items: [],
    next_action: '无',
    working_state: {
      current_goal: '重构认证模块',
      effective_decisions: ['沿用 bcrypt cost=12'],
      rejected_decisions: ['cost=16 —— 编辑时 sha mismatch，且性能开销未评估'],
      architecture_boundaries: ['密码哈希只在 auth.rs 内进行'],
      remaining_work: [],
    },
  }
}

describe('commit 校验：合格提交', () => {
  it('完整提交通过', () => {
    const r = validateCommitPayload(validPayload(), REQUIRED)
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('open_items / remaining_work 为空数组是合法的', () => {
    const p = validPayload()
    p.open_items = []
    p.working_state.remaining_work = []
    expect(validateCommitPayload(p, REQUIRED).valid).toBe(true)
  })
})

describe('commit 校验：形状合法但无信息', () => {
  it('causal_steps 为空数组被拒', () => {
    const p = validPayload()
    p.causal_steps = []
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('causal_steps'))).toBe(true)
  })

  it('causal_steps 含空对象被拒 —— 这是最容易蒙过去的形态', () => {
    const p = validPayload()
    p.causal_steps = [{}] as never
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('causal_steps[0].intent 为空')
    expect(r.errors).toContain('causal_steps[0].tool_action 为空')
    expect(r.errors).toContain('causal_steps[0].result 为空')
  })

  it('causal_steps 子字段只有空白字符被拒', () => {
    const p = validPayload()
    p.causal_steps = [{ intent: '  ', tool_action: '\n\t', result: '有结果' }] as never
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('causal_steps[0].intent 为空')
    expect(r.errors).toContain('causal_steps[0].tool_action 为空')
    expect(r.errors).not.toContain('causal_steps[0].result 为空')
  })

  it('evidence_fragments 为空数组被拒 —— 那是 L2 的主体', () => {
    const p = validPayload()
    p.evidence_fragments = []
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('evidence_fragments'))).toBe(true)
  })

  it('evidence_fragments 只写路径不写内容被拒', () => {
    const p = validPayload()
    p.evidence_fragments = [{ source: 'auth.rs', fragment: '', relevance: '相关' }] as never
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('evidence_fragments[0].fragment 为空')
  })

  it('working_state 缺 rejected_decisions 被拒 —— 防重复踩坑的唯一载体', () => {
    const p = validPayload()
    delete (p.working_state as Record<string, unknown>).rejected_decisions
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('working_state.rejected_decisions 必须是数组')
  })

  it('working_state.current_goal 为空被拒', () => {
    const p = validPayload()
    p.working_state.current_goal = '   '
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('working_state.current_goal 为空')
  })

  it('缺字段和内容为空会同时报出，便于模型一次修完', () => {
    const p = validPayload()
    delete (p as Record<string, unknown>).conclusion
    p.task_goal = ''
    const r = validateCommitPayload(p, REQUIRED)
    expect(r.errors).toContain('缺少 conclusion')
    expect(r.errors).toContain('task_goal 为空')
  })
})

describe('commit 校验：非法输入', () => {
  it('非对象被拒', () => {
    for (const bad of [null, undefined, 'text', 42, []]) {
      expect(validateCommitPayload(bad, REQUIRED).valid).toBe(false)
    }
  })
})

describe('commit 存储与认领', () => {
  beforeEach(() => resetCommitStore())

  it('有效提交后 hasValidCommit 为真', () => {
    expect(hasValidCommit('s1')).toBe(false)
    recordCommit('s1', validPayload(), 8, { valid: true, errors: [] })
    expect(hasValidCommit('s1')).toBe(true)
  })

  it('无效提交不算已提交，但错误可读', () => {
    recordCommit('s1', {}, 8, { valid: false, errors: ['causal_steps 至少包含一个因果步骤'] })
    expect(hasValidCommit('s1')).toBe(false)
    expect(lastCommitErrors('s1')).toContain('causal_steps 至少包含一个因果步骤')
  })

  it('会话之间互不影响', () => {
    recordCommit('s1', validPayload(), 8, { valid: true, errors: [] })
    expect(hasValidCommit('s2')).toBe(false)
  })

  it('提交必须落在块范围内才被绑定', () => {
    // 块0 = 消息 [0,3)，块1 = [3,6)。提交发生在第 5 条 = 块1 进行中。
    recordCommit('s1', validPayload(), 5, { valid: true, errors: [] })

    bindCommitToBlock('s1', 'block0', 0, 3)
    expect(getBoundCommit('s1', 'block0')).toBeNull()

    bindCommitToBlock('s1', 'block1', 3, 6)
    expect(getBoundCommit('s1', 'block1')).not.toBeNull()
  })

  it('补交回环后绑定最后一次有效提交', () => {
    recordCommit('s1', { task_goal: '第一次' }, 4, { valid: false, errors: ['x'] })
    recordCommit('s1', { task_goal: '第二次' }, 5, { valid: true, errors: [] })
    bindCommitToBlock('s1', 'block1', 3, 6)
    expect(getBoundCommit('s1', 'block1')?.payload.task_goal).toBe('第二次')
  })

  it('已绑定的不被后续提交覆盖 —— 摘要不该在后续轮次悄悄变化', () => {
    recordCommit('s1', { task_goal: '原始' }, 5, { valid: true, errors: [] })
    bindCommitToBlock('s1', 'block1', 3, 6)
    const first = getBoundCommit('s1', 'block1')

    recordCommit('s1', { task_goal: '后来的' }, 5, { valid: true, errors: [] })
    bindCommitToBlock('s1', 'block1', 3, 6)
    expect(getBoundCommit('s1', 'block1')).toBe(first)
  })

  it('绑定跨越 clearPending 存活 —— 块降层时才需要它', () => {
    // 这是最关键的时序：提交时块在 L0，压缩发生在它降到 L1 之后的某一轮
    recordCommit('s1', validPayload(), 5, { valid: true, errors: [] })
    bindCommitToBlock('s1', 'block1', 3, 6)
    const bound = getBoundCommit('s1', 'block1')
    expect(bound).not.toBeNull()

    clearPending('s1')
    expect(hasValidCommit('s1')).toBe(false)
    expect(getBoundCommit('s1', 'block1')).toBe(bound)
  })

  it('校验未通过的提交不被绑定', () => {
    recordCommit('s1', { task_goal: '不合格' }, 5, { valid: false, errors: ['e'] })
    bindCommitToBlock('s1', 'block1', 3, 6)
    expect(getBoundCommit('s1', 'block1')).toBeNull()
  })
})
