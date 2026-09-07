import { Menu, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { ProviderModelInfo, ProviderOptions } from '@shared/types'
import {
  getReasoningControlCapabilities,
  getReasoningControlLevel,
  getReasoningControlOptions,
  type ReasoningControlDisabledReason,
  type ReasoningControlLevel,
  type ReasoningControlOption,
} from '@shared/utils/reasoning-control'
import { IconBrain, IconCircleOff, IconSparkles } from '@tabler/icons-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'

interface ReasoningControlButtonProps {
  provider?: string
  model?: ProviderModelInfo | null
  providerOptions?: ProviderOptions
  iconSize: number
  onChange: (level: ReasoningControlLevel) => void
}

const LEVEL_COLORS: Record<ReasoningControlLevel, string> = {
  default: 'var(--chatbox-tint-tertiary)',
  off: 'var(--chatbox-tint-tertiary)',
  low: 'var(--chatbox-tint-secondary)',
  medium: 'var(--chatbox-tint-brand)',
  high: 'var(--chatbox-tint-brand)',
}

export default function ReasoningControlButton({
  provider,
  model,
  providerOptions,
  iconSize,
  onChange,
}: ReasoningControlButtonProps) {
  const { t } = useTranslation()
  const capabilities = useMemo(() => getReasoningControlCapabilities(provider, model), [provider, model])
  const level = useMemo(
    () => getReasoningControlLevel(provider, model, providerOptions),
    [provider, model, providerOptions]
  )
  const options = useMemo(() => getReasoningControlOptions(provider, model), [provider, model])

  if (!capabilities.supported && !capabilities.disabledReason) {
    return null
  }

  if (capabilities.disabledReason) {
    return (
      <Tooltip label={getDisabledReasonLabel(capabilities.disabledReason, t)} position="top" withArrow>
        <span>
          <UnstyledButton
            data-testid={TestId.reasoning.trigger}
            className="flex items-center gap-1 px-2 py-1 rounded-lg cursor-not-allowed opacity-60"
            style={{ color: 'var(--chatbox-tint-tertiary)' }}
            disabled
          >
            <IconBrain size={iconSize} strokeWidth={1.8} />
          </UnstyledButton>
        </span>
      </Tooltip>
    )
  }

  const selectedOption = options.find((item) => item.level === level)
  const levelLabel = getOptionLabel(selectedOption || { level, label: level }, t)

  return (
    <Menu
      shadow="md"
      trigger="click"
      position="top-start"
      openDelay={100}
      closeDelay={100}
      keepMounted
      transitionProps={{ transition: 'pop', duration: 200 }}
    >
      <Menu.Target>
        <span className="inline-flex">
          <Tooltip label={t('Thinking: {{level}}', { level: levelLabel })} position="top" withArrow>
            <UnstyledButton
              data-testid={TestId.reasoning.trigger}
              className={
                'flex items-center gap-1 px-2 py-1 rounded-lg ' +
                'hover:bg-[var(--chatbox-background-tertiary)] transition-colors'
              }
              style={{ color: LEVEL_COLORS[level] }}
              aria-label={t('Thinking: {{level}}', { level: levelLabel })}
            >
              {/* Icon-only collapsed state: the level text lives in the menu items,
                  keeping ~40px of toolbar width. */}
              <CompactReasoningLevelIcon level={level} size={iconSize} />
            </UnstyledButton>
          </Tooltip>
        </span>
      </Menu.Target>
      <Menu.Dropdown data-testid={TestId.reasoning.menu}>
        <Menu.Label fw={600}>{t('Thinking Effort')}</Menu.Label>
        {options.map((item) => (
          <Menu.Item
            data-testid={TestId.reasoning.level(item.level)}
            key={item.level}
            leftSection={<ReasoningLevelStatusIcon level={item.level} size={14} />}
            onClick={() => onChange(item.level)}
            color={item.level === level ? 'chatbox-brand' : undefined}
          >
            {getOptionLabel(item, t)}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

type ReasoningEffortLevel = Exclude<ReasoningControlLevel, 'default' | 'off'>

const REASONING_LEVEL_DOT_COUNTS: Record<ReasoningEffortLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
}

function CompactReasoningLevelIcon({ level, size }: { level: ReasoningControlLevel; size: number }) {
  const statusSize = Math.max(10, Math.round(size * 0.5))

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} data-reasoning-level={level}>
      <IconBrain size={size} strokeWidth={1.8} />
      <ReasoningLevelStatusIcon
        level={level}
        size={statusSize}
        className="absolute -bottom-0.5 -right-0.5 bg-[var(--chatbox-background-secondary)]"
      />
    </span>
  )
}

function ReasoningLevelStatusIcon({
  level,
  size,
  className = '',
}: {
  level: ReasoningControlLevel
  size: number
  className?: string
}) {
  if (level === 'default' || level === 'off') {
    const StatusIcon = level === 'default' ? IconSparkles : IconCircleOff
    return (
      <StatusIcon
        aria-hidden
        size={size}
        strokeWidth={2.4}
        className={`rounded-full ${className}`}
        data-reasoning-status={level}
      />
    )
  }

  const activeDotCount = REASONING_LEVEL_DOT_COUNTS[level]
  const dotSize = Math.max(2, Math.round(size * 0.2))

  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center gap-px rounded-full ${className}`}
      style={{ width: size, height: size }}
      data-reasoning-status={level}
    >
      {[0, 1, 2].map((index) => {
        const active = index < activeDotCount
        return (
          <span
            key={index}
            className="rounded-full bg-current"
            style={{ width: dotSize, height: dotSize, opacity: active ? 1 : 0.25 }}
            data-reasoning-dot={active ? 'active' : 'inactive'}
          />
        )
      })}
    </span>
  )
}

// Literal t() calls so i18next-parser (which only scans src/renderer) can extract the keys
function getDisabledReasonLabel(reason: ReasoningControlDisabledReason, t: (key: string) => string): string {
  switch (reason) {
    case 'requires-anthropic-api-style':
      return t(
        'Thinking controls are disabled because this Claude model is not exposed through the Anthropic API style.'
      )
    case 'requires-google-api-style':
      return t('Thinking controls are disabled because this Gemini model is not exposed through the Google API style.')
    case 'requires-openai-api-style':
      return t('Thinking controls are disabled because this GPT model is not exposed through an OpenAI API style.')
    case 'requires-deepseek-api-style':
      return t(
        'Thinking controls are disabled because this DeepSeek model is not exposed through the DeepSeek API style.'
      )
    case 'requires-qwen-api-style':
      return t('Thinking controls are disabled because this Qwen model is not exposed through the Qwen API style.')
    case 'requires-xai-api-style':
      return t('Thinking controls are disabled because this Grok model is not exposed through the xAI API style.')
  }
}

function getOptionLabel(option: ReasoningControlOption, t: (key: string) => string): string {
  if (option.label === 'on') return t('On')
  return getLevelLabel(option.level, t)
}

function getLevelLabel(level: ReasoningControlLevel, t: (key: string) => string): string {
  switch (level) {
    case 'default':
      return t('Default')
    case 'off':
      return t('Off')
    case 'low':
      return t('Low')
    case 'medium':
      return t('Medium')
    case 'high':
      return t('High')
  }
}
