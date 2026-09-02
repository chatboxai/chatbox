/**
 * Tokenizer Module
 *
 * This module provides token estimation functions for different model types.
 * It supports both the default tiktoken-based tokenizer and DeepSeek-specific tokenization.
 */

import { Tiktoken } from 'js-tiktoken/lite'
// @ts-ignore
import cl100k_base from 'js-tiktoken/ranks/cl100k_base'
export type TokenizerType = 'default' | 'deepseek'

// ============================================================================
// Error reporting seam
// ============================================================================

/**
 * `estimateTokens` swallows errors and returns 0. Each shell injects its own
 * reporter so the failure still gets surfaced: the renderer wires this to
 * `Sentry.captureException` (matching the pre-extraction behavior), native can
 * wire its own logger. Defaults to a no-op so shared stays platform-agnostic.
 */
let reportTokenizerError: (error: unknown) => void = () => {}

export function setTokenizerErrorReporter(reporter: (error: unknown) => void): void {
  reportTokenizerError = reporter
}

// ============================================================================
// Singleton Tokenizer Instance
// ============================================================================

/**
 * Singleton tiktoken encoder instance using cl100k_base encoding.
 * This is the same encoding used by GPT-4 and GPT-3.5-turbo.
 */
const encoding = new Tiktoken(cl100k_base)

// ============================================================================
// Types
// ============================================================================

/**
 * Model type for token counting.
 * Used to determine which tokenizer to use based on the model.
 */
export type TokenModel =
  | {
      provider: string
      modelId: string
    }
  | null
  | undefined

// ============================================================================
// Model Detection
// ============================================================================

/**
 * Check if a model is a DeepSeek model.
 * DeepSeek models use a different tokenization algorithm.
 *
 * @param model - The model to check
 * @returns true if the model is a DeepSeek model
 */
export function isDeepSeekModel(model?: TokenModel): boolean {
  if (!model) return false
  const modelId = model.modelId?.toLowerCase() || ''
  return modelId.includes('deepseek')
}

/**
 * Get the tokenizer type for a given model.
 *
 * @param model - The model to get tokenizer type for
 * @returns The tokenizer type to use
 */
export function getTokenizerType(model?: TokenModel): TokenizerType {
  return isDeepSeekModel(model) ? 'deepseek' : 'default'
}

// ============================================================================
// DeepSeek Tokenizer
// ============================================================================

/**
 * CJK Unified Ideographs plus extension and compatibility blocks. Astral
 * ranges must use \u{...} with the `u` flag: written as bare \u20000 they
 * parse as \u2000 + "0", forming a 0x30-0x2A6D range that matches ASCII
 * letters/digits and made English text count as Chinese. Astral members only
 * match full characters (code points), never a lone surrogate code unit.
 */
export const CJK_CHARACTER_PATTERN =
  /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\uf900-\ufaff\u{2f800}-\u{2fa1f}]/u

/**
 * Estimate tokens for DeepSeek models.
 *
 * DeepSeek uses a different tokenization algorithm:
 * - Chinese characters (CJK): ~0.6 tokens each
 * - English characters, numbers, symbols: ~0.3 tokens each
 * - Whitespace: 1 token (consecutive spaces count as 1)
 *
 * Reference: https://api-docs.deepseek.com/zh-cn/quick_start/token_usage
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count (minimum 1)
 */
export function estimateDeepSeekTokens(text: string): number {
  let total = 0
  let prevSpace = false

  for (const char of text) {
    // Check if character is Chinese (CJK Unified Ideographs)
    if (CJK_CHARACTER_PATTERN.test(char)) {
      // Chinese character ≈ 0.6 token
      total += 0.6
      prevSpace = false
    } else if (/\s/.test(char)) {
      // Space counts as 1 token
      // if previous character is not a space, add 1 token
      if (!prevSpace) {
        total += 1
        prevSpace = true
      }
    } else if (/[a-zA-Z0-9]/.test(char) || /[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/.test(char)) {
      // English character/number/symbol ≈ 0.3 token
      total += 0.3
      prevSpace = false
    } else {
      // Other characters
      total += 0.3
      prevSpace = false
    }
  }

  // Round up to nearest integer, minimum 1
  return Math.max(Math.ceil(total), 1)
}

// ============================================================================
// Main Tokenizer Function
// ============================================================================

/**
 * Estimate the number of tokens in a string.
 *
 * Uses the appropriate tokenizer based on the model:
 * - DeepSeek models: Uses DeepSeek-specific tokenization
 * - Other models: Uses tiktoken cl100k_base encoding
 *
 * @param str - The string to estimate tokens for (non-strings are JSON.stringify'd)
 * @param model - Optional model to determine tokenizer type
 * @returns Estimated token count (0 on error)
 */
export function estimateTokens(str: string, model?: TokenModel): number {
  try {
    str = typeof str === 'string' ? str : JSON.stringify(str)

    // Use DeepSeek tokenizer for DeepSeek models
    if (isDeepSeekModel(model)) {
      return estimateDeepSeekTokens(str)
    }

    // Use default tokenizer for other models
    const tokens = encoding.encode(str)
    return tokens.length
  } catch (e) {
    reportTokenizerError(e)
    return 0
  }
}

/** Sentinel model that routes type-addressed estimation to the DeepSeek tokenizer. */
const DEEPSEEK_TOKEN_MODEL: TokenModel = { provider: 'deepseek', modelId: 'deepseek-chat' }

/**
 * Estimate tokens when only the tokenizer type is known (worker requests,
 * queued computation tasks). Callers holding a model should use
 * `estimateTokens` directly.
 */
export function estimateTokensForTokenizerType(text: string, tokenizerType: TokenizerType): number {
  return estimateTokens(text, tokenizerType === 'deepseek' ? DEEPSEEK_TOKEN_MODEL : undefined)
}
