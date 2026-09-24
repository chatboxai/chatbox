/**
 * commit-config.ts — 实时自报（commit_task_memory）的外部配置加载
 *
 * 与 curator-config.ts 同构：schema / 描述 / 协议说明属于产品核心设计，
 * 不写进这份会被打包分发的源码。由 scripts/gen-curator-config.mjs 从
 * context-amp-mcp 生成，注入 CTX_AMP_COMMIT。
 *
 * 为什么要实时自报（对比 curator 事后整理）：
 * 模型写最终回答那一刻，"为什么否决了方案 B""哪一步失败及原因"都还在它的
 * 工作记忆里。事后让 curator 读历史消息只能**推断**这些因果，而且容易把
 * "被否决的方案"当噪音删掉——那恰好是防止后续重复踩坑的关键信息。
 *
 * 一个任务块的粒度是"用户提问→下一个用户提问"，块内可以有任意多个 assistant
 * 轮次（实测长任务块 8 条消息 / 4 个 assistant 轮次 / 3 次工具调用）。块越长，
 * 事后重建的失真越大。
 */

export interface CommitConfig {
  /** 填字工具名，模型在最终答复前必须调用它 */
  toolName: string
  /** 工具描述（给模型看的） */
  description: string
  /** JSON Schema */
  parameters: Record<string, unknown>
  /** 必填字段名列表 */
  requiredFields: string[]
  /** 提交协议说明，注入系统提示词 */
  notice: string
  /** 校验失败后的补交次数上限，默认 3（原设计值） */
  maxCorrectionAttempts: number
}

let cached: CommitConfig | null | undefined

/**
 * 读取实时自报配置。未配置时返回 null——此时不注册 commit 工具，
 * L2 退回 curator 事后整理，而不是让整层失效。
 */
export function getCommitConfig(): CommitConfig | null {
  if (cached !== undefined) return cached

  const raw = readRawConfig()
  if (!raw) {
    cached = null
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CommitConfig>
    if (!parsed.toolName || !parsed.parameters) {
      console.warn('[Commit] 配置缺少 toolName / parameters，忽略')
      cached = null
      return null
    }
    cached = {
      toolName: parsed.toolName,
      description: parsed.description ?? '',
      parameters: parsed.parameters,
      requiredFields: Array.isArray(parsed.requiredFields) ? parsed.requiredFields : [],
      notice: parsed.notice ?? '',
      maxCorrectionAttempts:
        typeof parsed.maxCorrectionAttempts === 'number' ? parsed.maxCorrectionAttempts : 3,
    }
    return cached
  } catch (error) {
    console.warn('[Commit] 配置解析失败:', error instanceof Error ? error.message : error)
    cached = null
    return null
  }
}

function readRawConfig(): string | undefined {
  // 必须写成静态的 `process.env.CTX_AMP_COMMIT`：electron-vite 的 define 是
  // 文本替换，只认字面量形式。
  const inlined = typeof process !== 'undefined' ? process.env.CTX_AMP_COMMIT : undefined
  if (inlined && inlined.trim()) return inlined

  if (typeof window !== 'undefined') {
    const injected = (window as unknown as Record<string, unknown>).__CTX_AMP_COMMIT__
    if (typeof injected === 'string' && injected.trim()) return injected
  }
  return undefined
}

/** 测试用：重置缓存 */
export function resetCommitConfigCache(): void {
  cached = undefined
}
