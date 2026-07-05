import * as Sentry from '@shared/sentry-shim'
import { countWord as sharedCountWord } from '../../shared/utils/word_count'

/**
 * Renderer 层的 countWord 包装器，包含 Sentry 错误报告
 */
export function countWord(data: string): number {
  try {
    return sharedCountWord(data)
  } catch (e) {
    Sentry.captureException(e)
    return -1
  }
}
