import { uniqBy } from 'lodash'
import type { ProviderInfo, ProviderModelInfo } from '../../../shared/types'

/**
 * Pure insertion-planning and model-display helpers for the composer, extracted
 * from `InputBox.tsx` so the limit/dedup/messaging decisions can be characterized
 * in isolation. The component owns the effects (state updates, toasts, kicking
 * off preprocessing); these functions only decide what should happen.
 */

export const MAX_LINKS = 6

export interface LinkInsertionPlan {
  /** The next value for the links state (deduped, capped at MAX_LINKS). */
  links: { url: string }[]
  /** True when links were dropped and the "extra links skipped" toast should show. */
  droppedSome: boolean
  /**
   * The subset of the requested urls that survived the cap and should start
   * preprocessing. Faithful to the original loop: iterated in request order,
   * duplicates in the request preserved.
   */
  urlsToPreprocess: string[]
}

/**
 * Plan inserting `urls` into the existing link list: dedup by url, keep the
 * first MAX_LINKS (earliest-added win), and preprocess only the kept ones.
 */
export function planLinkInsertion(existing: { url: string }[] | null | undefined, urls: string[]): LinkInsertionPlan {
  const dedupedLinks = uniqBy([...(existing || []), ...urls.map((u) => ({ url: u }))], 'url')
  // 保留最先添加的前 6 个链接，多出来的直接丢弃（而非静默丢掉最早的）
  const links = dedupedLinks.slice(0, MAX_LINKS)

  // 只预处理实际保留下来的链接（findIndex 返回 -1 表示该链接已被裁剪，跳过）
  const urlsToPreprocess = urls.filter((url) => {
    const linkIndex = links.findIndex((l) => l.url === url)
    return linkIndex >= 0 && linkIndex < MAX_LINKS
  })

  return { links, droppedSome: dedupedLinks.length > links.length, urlsToPreprocess }
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Map an unsupported-file classification (`getUnsupportedFileType`) to the
 * user-facing toast message. Falls back to the generic "Unsupported file type"
 * message for unknown classifications.
 */
export function getUnsupportedFileMessage(unsupportedType: string | null, fileName: string, t: Translate): string {
  switch (unsupportedType) {
    case 'iwork':
      return t('iWork files (Pages, Keynote) are not supported. Please export to PDF or Office format.')
    case 'audio':
      return t('Audio files are not supported')
    case 'video':
      return t('Video files are not supported')
    case 'binary':
      return t('Binary/executable files are not supported')
    case 'archive':
      return t('Archive files are not supported. Please extract and upload individual files.')
    case 'image':
      return t('Advanced image formats are not supported. Please convert to JPG or PNG.')
    default:
      return t('Unsupported file type: {{fileName}}', { fileName })
  }
}

/** Look up a model's info in the selected provider's model list (custom or default). */
export function findProviderModelInfo(
  providers: ProviderInfo[],
  model: { provider: string; modelId: string }
): ProviderModelInfo | undefined {
  const providerInfo = providers.find((p) => p.id === model.provider)
  return (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find((m) => m.modelId === model.modelId)
}

/** The composer's model-selector label: nickname, raw model id, or the pick-one prompt. */
export function resolveModelDisplayText(
  providers: ProviderInfo[],
  model: { provider: string; modelId: string } | undefined,
  t: Translate
): string {
  if (!model) {
    return t('Select Model')
  }
  const modelInfo = findProviderModelInfo(providers, model)
  return `${modelInfo?.nickname || model.modelId}`
}
