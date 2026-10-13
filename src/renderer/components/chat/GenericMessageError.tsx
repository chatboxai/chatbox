import { ActionIcon, Button, Flex, Loader, Text } from '@mantine/core'
import { Link } from '@mui/material'
import { TestId } from '@shared/automation/testids'
import { aiProviderNameHash } from '@shared/models'
import type { Message } from '@shared/types'
import { ModelProviderEnum } from '@shared/types/provider'
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconLanguage,
  IconReload,
} from '@tabler/icons-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ChatboxAIErrorMessage } from '@/components/common/ChatboxAIErrorMessage'
import { ErrorNotice } from '@/components/common/ErrorNotice'
import classes from '@/components/common/ErrorNotice.module.css'
import LinkTargetBlank from '@/components/common/Link'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useCopied } from '@/hooks/useCopied'
import { navigateToSettings } from '@/modals/settings-navigation'
import { buildChatboxUrl } from '@/packages/remote'
import { translateTexts } from '@/packages/translation'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'
import type { MessageErrorPresentation } from './message-error-presentation'

const MAX_CHARS = 200
const MAX_LINES = 3

type GenericPresentation = Exclude<MessageErrorPresentation, { kind: 'quota' } | { kind: 'agent-mode-reward' }>

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

function shouldTruncate(text: string): boolean {
  return text.length > MAX_CHARS || text.split('\n').length > MAX_LINES
}

function getTruncatedText(text: string): string {
  if (text.length > MAX_CHARS) return `${text.slice(0, MAX_CHARS)}...`
  const lines = text.split('\n')
  return lines.length > MAX_LINES ? `${lines.slice(0, MAX_LINES).join('\n')}...` : text
}

const errorLinkStyle: React.CSSProperties = {
  color: 'var(--chatbox-tint-brand)',
  font: 'inherit',
  fontStyle: 'normal',
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
    <Flex gap={4} className={classes.actions}>
      {showTranslateButton && (
        <Tooltip label={translatedText ? t('Show original') : t('Translate')} withArrow openDelay={1000}>
          <ActionIcon
            className={classes.action}
            variant="subtle"
            size="sm"
            color="gray"
            disabled={isTranslating}
            onClick={onTranslate}
            aria-label={translatedText ? t('Show original') : t('Translate')}
          >
            {isTranslating ? <Loader size={14} color="gray" /> : <IconLanguage size={14} />}
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label={t('Copy')} withArrow openDelay={1000}>
        <ActionIcon
          className={classes.action}
          variant="subtle"
          size="sm"
          color="gray"
          onClick={onCopy}
          aria-label={copied ? t('Copied') : t('Copy')}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </ActionIcon>
      </Tooltip>
    </Flex>
  )
}

function getProviderName(providerId?: string): string {
  return (providerId && aiProviderNameHash[providerId as keyof typeof aiProviderNameHash]) || 'AI Provider'
}

function ErrorTip({ presentation, model }: { presentation: GenericPresentation; model?: string }) {
  switch (presentation.kind) {
    case 'context-limit':
      return (
        <Trans i18nKey="Your conversation has exceeded the model's context limit. Try compressing the conversation, starting a new chat, or reducing the number of context messages in settings." />
      )
    case 'ocr-failed':
      return (
        <Trans
          i18nKey="OCR processing failed (provider: {{aiProvider}}). Please check your <OpenSettingButton>OCR model settings</OpenSettingButton> and ensure the configured model is available."
          values={{ aiProvider: presentation.provider }}
          components={{
            OpenSettingButton: (
              <Link
                className="cursor-pointer"
                style={errorLinkStyle}
                onClick={() => navigateToSettings('/default-models')}
              />
            ),
          }}
        />
      )
    case 'api': {
      const httpStatusI18nKey = presentation.httpStatusCode
        ? httpStatusCodeI18nKeys[presentation.httpStatusCode]
        : undefined
      if (httpStatusI18nKey) {
        return <Trans i18nKey={httpStatusI18nKey} values={{ aiProvider: getProviderName(presentation.providerId) }} />
      }
      if (presentation.providerId === ModelProviderEnum.ChatboxAI) {
        return (
          <Trans
            i18nKey="Connection to {{aiProvider}} failed. This typically occurs due to a temporary service issue. Please try again later or <buttonOpenSettings>check your settings</buttonOpenSettings>."
            values={{ aiProvider: aiProviderNameHash[ModelProviderEnum.ChatboxAI] }}
            components={{
              buttonOpenSettings: (
                <a
                  className="cursor-pointer"
                  style={errorLinkStyle}
                  onClick={() => navigateToSettings(`/provider/${ModelProviderEnum.ChatboxAI}`)}
                />
              ),
            }}
          />
        )
      }
      return (
        <Trans
          i18nKey="Connection to {{aiProvider}} failed. This typically occurs due to incorrect configuration or {{aiProvider}} account issues. Please <buttonOpenSettings>check your settings</buttonOpenSettings> and verify your {{aiProvider}} account status, or purchase a <LinkToLicensePricing>Chatbox AI License</LinkToLicensePricing> to unlock all advanced models instantly without any configuration."
          values={{ aiProvider: getProviderName(presentation.providerId) }}
          components={{
            buttonOpenSettings: (
              <a
                className="cursor-pointer"
                style={errorLinkStyle}
                onClick={() =>
                  navigateToSettings(presentation.providerId ? `/provider/${presentation.providerId}` : '/provider')
                }
              />
            ),
            LinkToLicensePricing: (
              <LinkTargetBlank
                style={errorLinkStyle}
                href={buildChatboxUrl(
                  `/redirect_app/advanced_url_processing/${settingActions.getLanguage()}?utm_source=app&utm_content=msg_bad_provider`
                )}
              />
            ),
            a: (
              <a
                style={errorLinkStyle}
                href={buildChatboxUrl(`/redirect_app/faqs/${settingActions.getLanguage()}`)}
                target="_blank"
              />
            ),
          }}
        />
      )
    }
    case 'network': {
      const proxy = settingActions.getProxy()
      return (
        <>
          <Trans i18nKey="network error tips" values={{ host: presentation.host }} />
          {proxy && <Trans i18nKey="network proxy error tips" values={{ proxy }} />}
        </>
      )
    }
    case 'paint-not-supported':
      return (
        <Trans
          i18nKey="ai provider no implemented paint tips"
          values={{ aiProvider: getProviderName(presentation.providerId) }}
          components={[
            <Link key="link" className="cursor-pointer" style={errorLinkStyle} onClick={() => navigateToSettings()} />,
          ]}
        />
      )
    case 'provider-missing':
      return (
        <Trans i18nKey="The model provider used by this conversation has been removed. Please select another model and try again." />
      )
    case 'known-chatbox-api':
      return <ChatboxAIErrorMessage errorCode={presentation.errorCode} model={model} linkStyle={errorLinkStyle} />
    case 'unknown':
      return (
        <Trans
          i18nKey="unknown error tips"
          components={[
            <a
              key="a"
              style={errorLinkStyle}
              href={buildChatboxUrl(
                `/redirect_app/faqs/${settingActions.getLanguage()}?utm_source=app&utm_content=msg_error_unknown`
              )}
              target="_blank"
            />,
          ]}
        />
      )
  }
}

export function GenericMessageError(props: {
  msg: Message
  presentation: GenericPresentation
  onRetry?: () => void | Promise<void>
}) {
  const { msg, presentation, onRetry } = props
  const { t } = useTranslation()
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const language = useLanguage()
  const [retrying, setRetrying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [translation, setTranslation] = useState<{ source: string; text: string } | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const translatedText = translation?.source === presentation.errorMessage ? translation.text : null
  const displayedErrorMessage = translatedText ?? presentation.errorMessage
  const { copied, copy } = useCopied(displayedErrorMessage)
  const isTruncated = shouldTruncate(presentation.errorMessage)
  const showTranslateButton = language !== 'en' && presentation.errorMessage.length > 0
  const onlyShowTips = presentation.kind === 'known-chatbox-api'

  const handleTranslate = useCallback(async () => {
    if (translatedText) {
      setTranslation(null)
      return
    }
    setIsTranslating(true)
    try {
      const [result] = await translateTexts([presentation.errorMessage], language, { sourceLang: 'en' })
      if (result) setTranslation({ source: presentation.errorMessage, text: result })
    } catch {
      // Translation is optional; keep the original provider error visible.
    } finally {
      setIsTranslating(false)
    }
  }, [language, presentation.errorMessage, translatedText])

  return (
    <ErrorNotice testId={TestId.message.errorTips}>
      <div className={classes.tip}>
        <ErrorTip presentation={presentation} model={msg.model} />
      </div>
      {presentation.requestId && (
        <Text size="sm" c="chatbox-tertiary" className="break-all select-text" lh="20px">
          {t('Request ID: {{requestId}}', { requestId: presentation.requestId })}
        </Text>
      )}
      {onRetry && (
        <button
          type="button"
          className={classes.retry}
          disabled={retrying}
          aria-label={t('Retry') || undefined}
          data-testid={TestId.message.errorRetry}
          onClick={async () => {
            setRetrying(true)
            try {
              await onRetry()
            } finally {
              setRetrying(false)
            }
          }}
        >
          {t('Retry')}
          {retrying ? <Loader size={14} /> : <IconReload size={14} />}
        </button>
      )}
      {!onlyShowTips && displayedErrorMessage && (
        <div className={classes.details}>
          {isTruncated && (
            <ActionIcon
              variant="transparent"
              size={16}
              color="gray"
              className={classes.collapse}
              aria-label={expanded ? t('Show less') : t('Show more')}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            </ActionIcon>
          )}
          <div className={classes.detailText}>
            {isTruncated && !expanded ? getTruncatedText(displayedErrorMessage) : displayedErrorMessage}
          </div>
          <ErrorActionButtons
            showTranslateButton={showTranslateButton}
            translatedText={translatedText}
            isTranslating={isTranslating}
            copied={copied}
            onTranslate={() => {
              if (!expanded) setExpanded(true)
              void handleTranslate()
            }}
            onCopy={copy}
            t={t}
          />
        </div>
      )}
      {!licenseKey && msg.aiProvider !== ModelProviderEnum.ChatboxAI && (
        <div className={classes.trial}>
          <Tooltip
            label={t(
              'If you have never had a license before, you can claim it after logging in on the official website.'
            )}
            withArrow
            multiline
            maw={240}
            position="bottom-start"
          >
            <Button
              variant="default"
              size="xs"
              radius="sm"
              fw={400}
              styles={{ label: { whiteSpace: 'normal', textAlign: 'start' }, root: { height: 'auto' } }}
              leftSection={<span className={classes.trialDot} aria-hidden="true" />}
              rightSection={<IconArrowRight size={14} />}
              onClick={() => {
                trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                  pageName: JK_PAGE_NAMES.CHAT_PAGE,
                  content: 'chat_error',
                })
                platform.openLink('https://chatboxai.app/login')
              }}
            >
              {t('Chatbox AI free trial available')}
            </Button>
          </Tooltip>
        </div>
      )}
    </ErrorNotice>
  )
}
