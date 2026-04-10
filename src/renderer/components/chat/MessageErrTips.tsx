import { ActionIcon, Flex, Loader, Text, Tooltip } from '@mantine/core'
import { Link } from '@mui/material'
import { aiProviderNameHash } from '@shared/models'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { Message } from '@shared/types'
import { ModelProviderEnum } from '@shared/types/provider'
import { IconCheck, IconChevronDown, IconChevronUp, IconCopy, IconLanguage, IconReload } from '@tabler/icons-react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ChatboxAIErrorMessage } from '@/components/common/ChatboxAIErrorMessage'
import { useCopied } from '@/hooks/useCopied'
import { navigateToSettings } from '@/modals/Settings'
import { trackingEvent } from '@/packages/event'
import { buildChatboxUrl } from '@/packages/remote'
import { translateTexts } from '@/packages/translation'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'
import LinkTargetBlank from '../common/Link'

const MAX_CHARS = 200
const MAX_LINES = 3

/**
 * Detect HTML content in error messages (e.g., gateway error pages).
 */
function isHtmlContent(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase()
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
}

/**
 * i18n keys for common HTTP status code errors.
 * These provide user-friendly, translatable messages for server errors.
 */
const httpStatusCodeI18nKeys: Record<number, string> = {
  401: 'HTTP error: Unauthorized (401). Your authentication credentials are invalid or have expired. Please check your API key or login status.',
  403: 'HTTP error: Forbidden (403). You do not have permission to access this resource. Please check your API key permissions or account status.',
  408: 'HTTP error: Request Timeout (408). The server took too long to respond. Please try again later.',
  429: 'HTTP error: Too Many Requests (429). The service is currently experiencing high demand or resource limitations. Please wait a moment and try again.',
  500: 'HTTP error: Internal Server Error (500). The server encountered an unexpected error. Please try again later.',
  502: 'HTTP error: Bad Gateway (502). The server received an invalid response from the upstream service. This is usually a temporary issue, please try again later.',
  503: 'HTTP error: Service Unavailable (503). The server is temporarily unavailable, possibly due to maintenance or overload. Please try again later.',
  504: 'HTTP error: Gateway Timeout (504). The server did not receive a timely response from the upstream service. This is usually a temporary issue, please try again later.',
}

/**
 * Extract HTTP status code from error message or errorExtra.
 */
function getHttpStatusCode(msg: Message): number | undefined {
  // First check errorExtra.httpStatusCode (set by our request layer)
  const extraCode = msg.errorExtra?.['httpStatusCode']
  if (typeof extraCode === 'number' && extraCode >= 400) {
    return extraCode
  }
  // Fallback: parse from error message like "API Error: Status Code 504, ..."
  const match = msg.error?.match(/Status Code (\d{3})/)
  if (match) {
    return parseInt(match[1], 10)
  }
  return undefined
}

function shouldTruncate(text: string): boolean {
  if (text.length > MAX_CHARS) return true
  const lineCount = text.split('\n').length
  return lineCount > MAX_LINES
}

function getTruncatedText(text: string): string {
  if (text.length > MAX_CHARS) {
    return `${text.slice(0, MAX_CHARS)}...`
  }
  const lines = text.split('\n')
  if (lines.length > MAX_LINES) {
    return `${lines.slice(0, MAX_LINES).join('\n')}...`
  }
  return text
}

/**
 * Detects if an error message indicates a context length exceeded error from various AI providers.
 */
export function isContextLengthError(errorText: string | null | undefined): boolean {
  if (!errorText) return false
  const text = errorText.toLowerCase()

  if (text.includes('context_length_exceeded')) return true
  if (text.includes('prompt is too long')) return true
  if (text.includes('maximum context length')) return true
  if (text.includes('input token limit')) return true
  if (text.includes('token') && text.includes('exceed') && text.includes('limit')) return true
  if (text.includes('exceed') && text.includes('max_prompt_tokens')) return true

  return false
}

function ErrorActionButtons(props: {
  showTranslateButton: boolean
  translatedText: string | null
  isTranslating: boolean
  copied: boolean
  onTranslate: (e: React.MouseEvent) => void
  onCopy: (e: React.MouseEvent) => void
  t: (key: string) => string
}) {
  const { showTranslateButton, translatedText, isTranslating, copied, onTranslate, onCopy, t } = props
  return (
    <Flex justify="flex-end" mt="xs" gap={4}>
      {showTranslateButton && (
        <Tooltip label={translatedText ? t('Show original') : t('Translate')} withArrow openDelay={1000}>
          <ActionIcon variant="subtle" size="sm" color="red" disabled={isTranslating} onClick={onTranslate}>
            {isTranslating ? <Loader size={14} color="red" /> : <IconLanguage size={14} />}
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label={t('Copy')} withArrow openDelay={1000}>
        <ActionIcon variant="subtle" size="sm" color="red" onClick={onCopy}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </ActionIcon>
      </Tooltip>
    </Flex>
  )
}

export default function MessageErrTips(props: { msg: Message; onRetry?: () => void; isBubbleLayout?: boolean }) {
  const { msg, onRetry, isBubbleLayout } = props
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const language = useLanguage()
  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)

  const errorMessage = msg.errorExtra?.responseBody
    ? (() => {
        const body = String(msg.errorExtra.responseBody)
        // Don't display raw HTML error pages (e.g., 502/503/504 gateway errors)
        if (isHtmlContent(body)) {
          return msg.error || 'The server returned an error page. Please try again later.'
        }
        try {
          const json = JSON.parse(body)
          return JSON.stringify(json, null, 2)
        } catch {
          return body
        }
      })()
    : msg.error || ''

  // Reset translation when the underlying error changes (e.g. after retry)
  useEffect(() => {
    setTranslatedText(null)
  }, [errorMessage])

  const displayedErrorMessage = translatedText ?? errorMessage
  const { copied, copy } = useCopied(displayedErrorMessage)
  const isTruncated = shouldTruncate(errorMessage)
  const showTranslateButton = language !== 'en' && errorMessage.length > 0

  const handleTranslate = useCallback(async () => {
    if (translatedText) {
      setTranslatedText(null)
      return
    }
    setIsTranslating(true)
    try {
      const [result] = await translateTexts([errorMessage], language, { sourceLang: 'en' })
      setTranslatedText(result ?? null)
    } catch {
      // ignore
    } finally {
      setIsTranslating(false)
    }
  }, [errorMessage, language, translatedText])

  if (!msg.error) {
    return null
  }

  const tips: React.ReactNode[] = []
  let onlyShowTips = false // 是否只显示提示，不显示错误信息详情

  if (isContextLengthError(msg.error) || isContextLengthError(errorMessage)) {
    tips.push(
      <Trans i18nKey="Your conversation has exceeded the model's context limit. Try compressing the conversation, starting a new chat, or reducing the number of context messages in settings." />
    )
  } else if (msg.error.startsWith('OCR Error')) {
    tips.push(
      <Trans
        i18nKey="OCR processing failed (provider: {{aiProvider}}). Please check your <OpenSettingButton>OCR model settings</OpenSettingButton> and ensure the configured model is available."
        values={{
          aiProvider: msg.errorExtra?.['aiProvider'] || 'AI Provider',
        }}
        components={{
          OpenSettingButton: (
            <Link
              className="cursor-pointer italic"
              onClick={() => {
                navigateToSettings('/default-models')
              }}
            ></Link>
          ),
        }}
      />
    )
  } else if (msg.error.startsWith('API Error')) {
    const httpStatusCode = getHttpStatusCode(msg)
    const httpStatusI18nKey = httpStatusCode ? httpStatusCodeI18nKeys[httpStatusCode] : undefined
    if (httpStatusI18nKey) {
      // Show specific i18n-translated HTTP status error tip (keep error details visible below)
      tips.push(
        <Trans
          i18nKey={httpStatusI18nKey}
          values={{
            aiProvider: msg.aiProvider
              ? aiProviderNameHash[msg.aiProvider as keyof typeof aiProviderNameHash]
              : 'AI Provider',
          }}
        />
      )
    } else if (msg.aiProvider === ModelProviderEnum.ChatboxAI) {
      tips.push(
        <Trans
          i18nKey="Connection to {{aiProvider}} failed. This typically occurs due to a temporary service issue. Please try again later or <buttonOpenSettings>check your settings</buttonOpenSettings>."
          values={{
            aiProvider: aiProviderNameHash[ModelProviderEnum.ChatboxAI],
          }}
          components={{
            buttonOpenSettings: (
              <a
                className="cursor-pointer underline font-bold hover:text-blue-600 transition-colors"
                onClick={() => {
                  navigateToSettings(`/provider/${ModelProviderEnum.ChatboxAI}`)
                }}
              />
            ),
          }}
        />
      )
    } else {
      tips.push(
        <Trans
          i18nKey="Connection to {{aiProvider}} failed. This typically occurs due to incorrect configuration or {{aiProvider}} account issues. Please <buttonOpenSettings>check your settings</buttonOpenSettings> and verify your {{aiProvider}} account status, or purchase a <LinkToLicensePricing>Chatbox AI License</LinkToLicensePricing> to unlock all advanced models instantly without any configuration."
          values={{
            aiProvider: msg.aiProvider
              ? aiProviderNameHash[msg.aiProvider as keyof typeof aiProviderNameHash]
              : 'AI Provider',
          }}
          components={{
            buttonOpenSettings: (
              <a
                className="cursor-pointer underline font-bold hover:text-blue-600 transition-colors"
                onClick={() => {
                  navigateToSettings(msg.aiProvider ? `/provider/${msg.aiProvider}` : '/provider')
                }}
              />
            ),
            LinkToLicensePricing: (
              <LinkTargetBlank
                className="!font-bold !text-gray-700 hover:!text-blue-600 transition-colors"
                href={buildChatboxUrl(
                  `/redirect_app/advanced_url_processing/${settingActions.getLanguage()}?utm_source=app&utm_content=msg_bad_provider`
                )}
              />
            ),
            a: <a href={buildChatboxUrl(`/redirect_app/faqs/${settingActions.getLanguage()}`)} target="_blank" />,
          }}
        />
      )
    }
  } else if (msg.error.startsWith('Network Error')) {
    tips.push(
      <Trans
        i18nKey="network error tips"
        values={{
          host: msg.errorExtra?.['host'] || 'AI Provider',
        }}
      />
    )
    const proxy = settingActions.getProxy()
    if (proxy) {
      tips.push(<Trans i18nKey="network proxy error tips" values={{ proxy }} />)
    }
  } else if (msg.errorCode === 10003) {
    tips.push(
      <Trans
        i18nKey="ai provider no implemented paint tips"
        values={{
          aiProvider: msg.aiProvider
            ? aiProviderNameHash[msg.aiProvider as keyof typeof aiProviderNameHash]
            : 'AI Provider',
        }}
        components={[
          <Link
            key="link"
            className="cursor-pointer font-bold"
            onClick={() => {
              navigateToSettings()
            }}
          ></Link>,
        ]}
      />
    )
  } else if (msg.errorCode && ChatboxAIAPIError.getDetail(msg.errorCode)) {
    onlyShowTips = true
    tips.push(<ChatboxAIErrorMessage errorCode={msg.errorCode} model={msg.model} />)
  } else {
    tips.push(
      <Trans
        i18nKey="unknown error tips"
        components={[
          <a
            key="a"
            href={buildChatboxUrl(
              `/redirect_app/faqs/${settingActions.getLanguage()}?utm_source=app&utm_content=msg_error_unknown`
            )}
            target="_blank"
          ></a>,
        ]}
      />
    )
  }
  return (
    <div
      role="alert"
      className={`message-error-tips text-sm text-chatbox-tint-error ${isBubbleLayout ? 'py-2' : 'px-4 py-3 rounded-lg border border-solid border-chatbox-border-error bg-chatbox-background-error-secondary'}`}
    >
      {tips.map((tip, i) => (
        <b key={`${i}-${tip}`}>{tip}</b>
      ))}
      {/* Intentional: icon + text label are separate click targets to enlarge the tap area */}
      {onRetry && (
        <Flex mt="xs" gap="xs" align="center">
          <ActionIcon variant="light" size="sm" color="red" onClick={onRetry} aria-label={t('Retry')}>
            <IconReload size={14} />
          </ActionIcon>
          <Text
            component="button"
            size="xs"
            c="chatbox-tertiary"
            className="cursor-pointer border-0 bg-transparent p-0"
            onClick={onRetry}
          >
            {t('Retry')}
          </Text>
        </Flex>
      )}
      {onlyShowTips ? null : (
        <>
          <br />
          <br />
          {isTruncated ? (
            <div
              className="text-sm p-2 rounded-md bg-red-50 dark:bg-red-900/20 cursor-pointer overflow-hidden"
              onClick={() => setExpanded(!expanded)}
            >
              <Flex align="flex-start" gap="xs" className="min-w-0">
                <ActionIcon variant="transparent" size="xs" c="red" p={0} className="flex-shrink-0">
                  {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                </ActionIcon>
                <div className="flex-1 min-w-0 whitespace-pre-wrap break-all">
                  {expanded ? displayedErrorMessage : getTruncatedText(displayedErrorMessage)}
                </div>
              </Flex>
              <ErrorActionButtons
                showTranslateButton={showTranslateButton}
                translatedText={translatedText}
                isTranslating={isTranslating}
                copied={copied}
                onTranslate={(e) => {
                  e.stopPropagation()
                  if (!expanded) setExpanded(true)
                  handleTranslate()
                }}
                onCopy={(e) => {
                  e.stopPropagation()
                  copy()
                }}
                t={t}
              />
            </div>
          ) : (
            <div className="text-sm p-2 rounded-md bg-red-50 dark:bg-red-900/20 overflow-hidden">
              <div className="whitespace-pre-wrap break-all">{displayedErrorMessage}</div>
              <ErrorActionButtons
                showTranslateButton={showTranslateButton}
                translatedText={translatedText}
                isTranslating={isTranslating}
                copied={copied}
                onTranslate={handleTranslate}
                onCopy={copy}
                t={t}
              />
            </div>
          )}
        </>
      )}
      {/* Free trial suggestion for users without license (skip for ChatboxAI errors) */}
      {!licenseKey && msg.aiProvider !== ModelProviderEnum.ChatboxAI && (
        <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-800/30 text-right">
          <Tooltip
            label={t(
              'If you have never had a license before, you can claim it after logging in on the official website.'
            )}
            withArrow
            multiline
            maw={240}
            position="bottom-end"
            styles={{
              tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(4px)',
              },
            }}
          >
            <span
              className="text-sm font-medium text-blue-600 cursor-pointer hover:text-blue-700 hover:underline transition-colors"
              onClick={() => {
                trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                  pageName: JK_PAGE_NAMES.CHAT_PAGE,
                  content: 'chat_error',
                })
                platform.openLink('https://chatboxai.app/login')
              }}
            >
              {t('Chatbox AI free trial available')} →
            </span>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
