/**
 * singleton.ts — StampStore 单例 + 压缩回调 + 开关状态
 *
 * 提供全局共享的 StampStore 实例和基于当前模型配置的压缩函数。
 * 供 orchestration.ts 和 agent-harness.ts 调用时传入 contextAmplifier 选项。
 *
 * 开关默认关闭（opt-in）：window.__CTX_AMP_ENABLED__ = true 或 setContextAmplifierEnabled(true) 开启。
 */
import type { ModelInterface } from '../models/types'
import type { ContextAmplifierOptions, StampStoreLike } from './pipeline'

// ── 开关状态 ────────────────────────────────────────────────────────
let _contextAmplifierEnabled = false

/**
 * 获取当前上下文放大开关状态。
 * 默认关闭（opt-in）。window.__CTX_AMP_ENABLED__ 每次实时读取，
 * 与 setContextAmplifierEnabled 的内存开关二选一（window 值优先）。
 */
export function isContextAmplifierEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __CTX_AMP_ENABLED__?: unknown }).__CTX_AMP_ENABLED__
    if (override === true || override === false) return override
  }
  return _contextAmplifierEnabled
}

/**
 * 设置上下文放大开关状态（运行时覆盖入口）
 */
export function setContextAmplifierEnabled(enabled: boolean): void {
  _contextAmplifierEnabled = enabled
}

// 默认导入以兼容 CommonJS（见 pipeline.ts 的说明）
import stampStoreCjs from './stamp-store.js'
import { getCuratorConfig } from './curator-config'
import { restoreStampStore, scheduleStampFlush } from './stamp-persist'
import providerProfileCjs from './provider-profile.js'

const StampStore = (stampStoreCjs as unknown as { StampStore: new () => StampStoreLike }).StampStore
const getProviderProfile = (
  providerProfileCjs as unknown as {
    getProviderProfile: (name: string) => { endpoint: string; format: string; defaultModel: string } | null
  }
).getProviderProfile

// ── 压缩 API 配置 ────────────────────────────────────────────────────
// 压缩服务用独立凭据，不复用会话 provider 的 key：那个 key 属于用户选定的
// 模型厂商（OpenAI/Anthropic/…），发到 sfkey 既不会认证成功，也等于把它
// 泄露给第三方端点。
//
// 这三处必须写成静态的 `process.env.X`：electron-vite 的 `define` 是文本替换，
// 只认字面量形式。动态访问（process.env[name]）不会被替换，在渲染进程里会
// 得到 undefined。运行时兜底读 window.__CTX_AMP_*__，便于不重新构建就临时覆盖。
function pickEnv(inlined: string | undefined, globalName: string): string | undefined {
  if (inlined) return inlined
  if (typeof window !== 'undefined') {
    const injected = (window as unknown as Record<string, unknown>)[globalName]
    if (typeof injected === 'string' && injected) return injected
  }
  return undefined
}

const COMPRESS_PROVIDER = pickEnv(process.env.CTX_AMP_PROVIDER, '__CTX_AMP_PROVIDER__') || 'ling'
const providerProfile = getProviderProfile(COMPRESS_PROVIDER) ?? getProviderProfile('ling')
const PROVIDER_PROFILE = providerProfile ?? {
  endpoint: 'https://api.ant-ling.com/anthropic/v1/messages',
  format: 'anthropic',
  defaultModel: 'Ling-3.0-flash',
}
const COMPRESS_API_ENDPOINT = pickEnv(process.env.CTX_AMP_ENDPOINT, '__CTX_AMP_ENDPOINT__') || PROVIDER_PROFILE.endpoint
const COMPRESS_MODEL = pickEnv(process.env.CTX_AMP_MODEL, '__CTX_AMP_MODEL__') || PROVIDER_PROFILE.defaultModel

function getCompressApiKey(): string | undefined {
  return pickEnv(process.env.CTX_AMP_KEY, '__CTX_AMP_KEY__')
}

export interface RecallConfig {
  endpoint: string
  apiKey: string
  model: string
  format: string
}

/** 召回复用压缩 provider 的 endpoint、key、model 和协议格式。 */
export function getRecallConfig(): RecallConfig | null {
  const apiKey = getCompressApiKey()
  if (!apiKey) return null
  return { endpoint: COMPRESS_API_ENDPOINT, apiKey, model: COMPRESS_MODEL, format: PROVIDER_PROFILE.format }
}

// ── 分层边界配置 ─────────────────────────────────────────────────────
// 单位是 token（cl100k_base），不是字节。早先按字节实现是错的：中文 UTF-8
// 约 3 字节/字，而 cl100k 约 0.6~1 token/字，200KB 字节只相当于 50~68K token，
// 会让压缩比预期提前约 3 倍触发。
/** L0 轮次数（最近 N 轮完整保留） */
export const L0_ROUND_COUNT = 2
/** L1 累计上限：200K tokens */
export const L1_THRESHOLD = 200_000
/** L2 累计上限：384K tokens */
export const L2_THRESHOLD = 384_000
/** L3 累计上限：712K tokens */
export const L3_THRESHOLD = 712_000
/** 召回余量：890K - 712K = 178K tokens */
export const RECALL_BUDGET = 890_000 - L3_THRESHOLD

// ── StampStore 单例 ──────────────────────────────────────────────────
let sharedStore: StampStoreLike | null = null

export function getSharedStampStore(): StampStoreLike {
  if (!sharedStore) {
    sharedStore = new StampStore() as StampStoreLike
  }
  return sharedStore
}

/**
 * 从磁盘恢复历史任务块。必须在渲染进程启动时调用一次。
 *
 * 不恢复的后果：历史消息里的 #STAMP 标记跟着会话一起存下来了，重启后仍在
 * 上下文里，而 store 是空的——模型按提示词发起召回，必然失败。
 */
export async function initStampStorePersistence(): Promise<void> {
  await restoreStampStore(getSharedStampStore())
}

// ── 便捷：构建 contextAmplifier 选项 ────────────────────────────────

/**
 * 构建 contextAmplifier 选项。
 *
 * 正常压缩凭据来自当前会话 model；CTX_AMP_* 仅保留给无模型实例的 curator 兼容路径。
 * 缺少凭据时仍返回选项，只是跳过远程 curator 压缩——分层、归档、按戳召回照常工作。
 *
 * @param enabled - 上下文放大功能是否启用（默认开启，可经 window.__CTX_AMP_ENABLED__ 覆盖）
 * @param sessionId - 会话 id，用于认领模型实时自报的任务记忆；不传则只走 curator
 * @returns contextAmplifier 选项，或 undefined（开关关闭）
 */
export function buildContextAmplifierOptions(
  enabled: boolean = true,
  sessionId?: string,
  model?: ModelInterface
): ContextAmplifierOptions | undefined {
  if (!enabled) return undefined

  const compressKey = getCompressApiKey()
  if (!compressKey) {
    // 没有压缩凭据时仍然返回选项：分层、归档、StampStore 存馆全部可用，
    // 只是不调压缩 API（各块退回默认摘要）。这样UI 压缩报告仍能显示分层情况，
    // 而不是整个引擎静默失效。
    console.warn('[ContextAmplifier] 未配置 CTX_AMP_KEY，分层与归档仍生效，但不执行 LLM 压缩')
  }

  const compressBlock = model
    ? async (systemPrompt: string, text: string, _opts?: { timeout?: number }) => {
        const result = await model.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          { maxSteps: 1 }
        )
        const summary = result.contentParts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
        return summary ? { ok: true, summary } : { ok: false }
      }
    : undefined

  return {
    store: getSharedStampStore(),
    ...(sessionId ? { sessionId } : {}),
    ...(compressBlock ? { compressBlock } : {}),
    l0RoundCount: L0_ROUND_COUNT,
    l1Threshold: L1_THRESHOLD,
    l2Threshold: L2_THRESHOLD,
    l3Threshold: L3_THRESHOLD,
    minMessages: 2,
    compressTimeout: 60000,
    // L2 结构化记忆：curator 配置存在时自动启用。配置（schema / 提示词 /
    // 必填字段）来自 CTX_AMP_CURATOR，不在源码里。
    ...(!model && compressKey && getCuratorConfig()
      ? { curatorApi: { endpoint: COMPRESS_API_ENDPOINT, apiKey: compressKey, model: COMPRESS_MODEL } }
      : {}),
    onReport: () => {
      // 每轮压缩结束后请求落盘（防抖 2s）。放在 onReport 而不是每次 store.add
      // 之后，是因为 add 在一轮里会被调用 N 次，而这里恰好是一轮的终点。
      scheduleStampFlush(getSharedStampStore())
    },
  }
}
