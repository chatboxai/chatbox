/**
 * curator-config.ts — L2 结构化记忆的外部配置加载
 *
 * 为什么外置：curator 的填字 schema、系统提示词和校验规则是产品的核心设计，
 * 不放进这份源码。运行时从环境变量指向的 JSON 文件加载。
 *
 * 配置文件形状（由外部提供，本文件不含任何具体内容）：
 * {
 *   "systemPrompt": "...",
 *   "toolName": "submit_curated_task_memory",
 *   "tool": { "type": "function", "function": { "name": "...", "parameters": {...} } },
 *   "requiredFields": ["..."],
 *   "maxAttempts": 5
 * }
 *
 * 环境变量：
 *   CTX_AMP_CURATOR_CONFIG  配置文件绝对路径（主进程读盘后注入渲染进程）
 *   CTX_AMP_CURATOR         直接内联 JSON（便于测试，优先级低于文件）
 */

export interface CuratorConfig {
  /** 整理子智能体的系统提示词 */
  systemPrompt: string
  /** 填字工具名，模型必须调用它 */
  toolName: string
  /** OpenAI function-calling 工具定义（含 JSON Schema） */
  tool: Record<string, unknown>
  /** 必填字段名列表，用于提交后的完整性校验 */
  requiredFields?: string[]
  /** 最大重试次数，默认 5 */
  maxAttempts?: number
}

import { L2_BUILTIN_CURATOR_CONFIG as builtinCuratorConfig } from './l2-prompts'

let cached: CuratorConfig | null | undefined

function toBuiltinCuratorConfig(): CuratorConfig {
  return builtinCuratorConfig as unknown as CuratorConfig
}

/**
 * 读取 curator 配置。
 * 现在内置强约束提示词与工具 schema 作为保底，不再完全依赖外部环境注入。
 * 若外部未配置，仍会使用内置结构化契约，保证 L2 强制结构化路径可继续执行。
 */
export function getCuratorConfig(): CuratorConfig | null {
  if (cached !== undefined) return cached

  const raw = readRawConfig()
  if (!raw) {
    cached = toBuiltinCuratorConfig()
    return cached
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CuratorConfig>
    if (!parsed.systemPrompt || !parsed.toolName || !parsed.tool) {
      console.warn('[Curator] 配置缺少 systemPrompt / toolName / tool，忽略')
      cached = null
      return null
    }
    cached = {
      systemPrompt: parsed.systemPrompt,
      toolName: parsed.toolName,
      tool: parsed.tool,
      requiredFields: Array.isArray(parsed.requiredFields) ? parsed.requiredFields : [],
      maxAttempts: typeof parsed.maxAttempts === 'number' ? parsed.maxAttempts : 5,
    }
    return cached
  } catch (error) {
    console.warn('[Curator] 配置解析失败:', error instanceof Error ? error.message : error)
    cached = null
    return null
  }
}

function readRawConfig(): string | undefined {
  // 必须写成静态的 `process.env.CTX_AMP_CURATOR`：electron-vite 的 define 是
  // 文本替换，只认字面量形式。动态访问（process.env[name]）不会被替换，
  // 在渲染进程里 process 不存在，会直接抛错。
  const inlined = typeof process !== 'undefined' ? process.env.CTX_AMP_CURATOR : undefined
  if (inlined && inlined.trim()) return inlined

  // 兜底：主进程也可在运行时注入到 window（便于不重新构建就换配置）
  if (typeof window !== 'undefined') {
    const injected = (window as unknown as Record<string, unknown>).__CTX_AMP_CURATOR__
    if (typeof injected === 'string' && injected.trim()) return injected
  }
  return undefined
}

/** 测试用：重置缓存 */
export function resetCuratorConfigCache(): void {
  cached = undefined
}
