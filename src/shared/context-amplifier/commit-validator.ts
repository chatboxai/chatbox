/**
 * commit-validator.ts — 实时自报提交的结构校验
 *
 * 这是质量门的判据部分。规则复刻原设计的 `validateCommitPayload`
 * （context-amp-mcp/lib/task-record.js）：不只查字段在不在，还查**内容有没有实质**。
 *
 * 为什么要这么严：模型很容易交出形状合法但没信息的记录——`causal_steps: [{}]`
 * 满足"数组非空"，却什么都没记。原设计因此逐项检查 intent/tool_action/result
 * 三个子字段，`evidence_fragments` 还必须非空（那是 L2 的主体，不是路径索引）。
 *
 * 字段名从外部配置的 requiredFields 读，但**子结构规则写在这里**——它们是
 * 记忆保真度的下限，不是可配置的偏好。
 */

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** 非空字符串（trim 后仍有内容） */
function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** 单行化后非空。原设计的 singleLine 会折叠换行，空白行不算内容。 */
function hasLine(value: unknown): boolean {
  return typeof value === 'string' && value.replace(/\s+/g, ' ').trim().length > 0
}

/**
 * 校验 commit_task_memory 的参数。
 *
 * @param payload 模型提交的参数对象
 * @param requiredFields 外部配置声明的必填字段
 */
export function validateCommitPayload(payload: unknown, requiredFields: string[]): ValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['参数必须是对象'] }
  }
  const p = payload as Record<string, unknown>
  const errors: string[] = []

  // 先按配置声明的必填字段查"在不在"，再对已知结构查"有没有实质内容"。
  // 这样配置侧增删字段时不用改本文件，而结构规则仍然生效。
  for (const field of requiredFields) {
    if (p[field] === undefined || p[field] === null) errors.push(`缺少 ${field}`)
  }

  if ('task_goal' in p && !hasText(p.task_goal)) errors.push('task_goal 为空')

  // causal_steps：因果链是 L2 的骨架。逐项查三个子字段，空对象不算一步。
  if ('causal_steps' in p) {
    if (!Array.isArray(p.causal_steps) || p.causal_steps.length === 0) {
      errors.push('causal_steps 至少包含一个因果步骤')
    } else {
      p.causal_steps.forEach((step, index) => {
        if (!step || typeof step !== 'object') {
          errors.push(`causal_steps[${index}] 必须是对象`)
          return
        }
        const s = step as Record<string, unknown>
        if (!hasLine(s.intent ?? s.purpose)) errors.push(`causal_steps[${index}].intent 为空`)
        if (!hasLine(s.tool_action ?? s.action)) errors.push(`causal_steps[${index}].tool_action 为空`)
        if (!hasLine(s.result)) errors.push(`causal_steps[${index}].result 为空`)
      })
    }
  }

  if ('conclusion' in p && !hasText(p.conclusion)) errors.push('conclusion 为空')

  for (const field of ['key_facts', 'evidence', 'open_items']) {
    if (field in p && !Array.isArray(p[field])) errors.push(`${field} 必须是数组`)
  }

  // evidence_fragments：L2 的主体。允许为空就等于允许交一份只有结论没有依据的
  // 记忆，后续模型无法据此继续推理，只能重新探索。
  if ('evidence_fragments' in p) {
    if (!Array.isArray(p.evidence_fragments)) {
      errors.push('evidence_fragments 必须是数组')
    } else if (p.evidence_fragments.length === 0) {
      errors.push('evidence_fragments 至少包含一个紧凑证据片段')
    } else {
      p.evidence_fragments.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
          errors.push(`evidence_fragments[${index}] 必须是对象`)
          return
        }
        const f = item as Record<string, unknown>
        if (!hasLine(f.source)) errors.push(`evidence_fragments[${index}].source 为空`)
        if (!hasText(f.fragment)) errors.push(`evidence_fragments[${index}].fragment 为空`)
        if (!hasLine(f.relevance)) errors.push(`evidence_fragments[${index}].relevance 为空`)
      })
    }
  }

  if ('next_action' in p && !hasText(p.next_action)) errors.push('next_action 为空')

  // working_state：跨块状态。rejected_decisions 尤其重要——它是"不要重新提议
  // 这个方案"的唯一载体，缺了它长程任务会反复踩同一个坑。
  if ('working_state' in p) {
    const ws = p.working_state
    if (!ws || typeof ws !== 'object' || Array.isArray(ws)) {
      errors.push('working_state 必须是对象')
    } else {
      const w = ws as Record<string, unknown>
      if (!hasText(w.current_goal)) errors.push('working_state.current_goal 为空')
      for (const field of [
        'effective_decisions',
        'rejected_decisions',
        'architecture_boundaries',
        'remaining_work',
      ]) {
        if (!Array.isArray(w[field])) errors.push(`working_state.${field} 必须是数组`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
