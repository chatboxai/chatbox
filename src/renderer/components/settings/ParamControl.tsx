import { Flex, NumberInput, SegmentedControl, Select, Stack } from '@mantine/core'
import { IconSelector } from '@tabler/icons-react'
import clsx from 'clsx'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SliderWithInput from '@/components/common/SliderWithInput'
import { useFieldDraft } from '@/hooks/useFieldDraft'
import { SettingRow, type SettingsDensity, useSettingsDensity } from './SettingsLayout'

const TEMPERATURE_PRESETS = [
  { key: 'precise', label: 'Precise', value: 0.3 },
  { key: 'balanced', label: 'Balanced', value: 1 },
  { key: 'creative', label: 'Creative', value: 1.5 },
] as const

function hasTouchPresets(density: SettingsDensity, kind: 'temperature' | 'topP') {
  return density === 'touch' && kind === 'temperature'
}

/**
 * Whether the control always shows its value field, so a row label can name it. Touch temperature
 * leads with presets and shows the field only under Custom.
 */
export function useSamplingFieldShown(kind: 'temperature' | 'topP') {
  return !hasTouchPresets(useSettingsDensity(), kind)
}

/**
 * Sampling parameter (temperature or top P). Wide layouts use a slider with a value field;
 * touch layouts pick temperature from Precise / Balanced / Creative and open the slider under
 * Custom. An unset value reads "Model default".
 */
export function SamplingParamControl({
  kind,
  value,
  onChange,
  inputTestId,
  clearable = true,
  inputId,
}: {
  kind: 'temperature' | 'topP'
  value?: number
  onChange(value?: number): void
  inputTestId?: string
  /** Id of the value field, for a label that names it. */
  inputId?: string
  /** Whether the value field offers a clear button; inherited values have nothing to clear. */
  clearable?: boolean
}) {
  const { t } = useTranslation()
  const density = useSettingsDensity()
  const max = kind === 'temperature' ? 2 : 1
  const matchedPreset =
    kind === 'temperature' ? TEMPERATURE_PRESETS.find((preset) => preset.value === value)?.key : undefined
  const [customOpen, setCustomOpen] = useState(value !== undefined && !matchedPreset)
  useEffect(() => {
    if (value !== undefined && !matchedPreset) setCustomOpen(true)
  }, [value, matchedPreset])

  const slider = (
    <SliderWithInput
      inputId={inputId}
      inputTestId={inputTestId}
      value={value}
      onChange={onChange}
      max={max}
      inputWidth={96}
      clearable={clearable}
      marks={kind === 'temperature' ? [{ value: 0 }, { value: 1 }, { value: 2 }] : undefined}
      scaleLabels={
        kind === 'temperature' && density !== 'touch'
          ? [`0 ${t('Precise')}`, `1.0 ${t('Balanced')}`, `2.0 ${t('Creative')}`]
          : undefined
      }
    />
  )

  if (!hasTouchPresets(density, kind)) return slider

  return (
    <Stack gap="xs">
      <SegmentedControl
        aria-label={t('Temperature') ?? undefined}
        fullWidth
        size="sm"
        radius="md"
        value={customOpen ? 'custom' : (matchedPreset ?? '')}
        onChange={(key) => {
          if (key === 'custom') {
            setCustomOpen(true)
            return
          }
          setCustomOpen(false)
          const preset = TEMPERATURE_PRESETS.find((item) => item.key === key)
          if (preset) onChange(preset.value)
        }}
        data={[
          ...TEMPERATURE_PRESETS.map((preset) => ({ value: preset.key, label: t(preset.label) })),
          { value: 'custom', label: t('Custom') },
        ]}
      />
      {customOpen && slider}
    </Stack>
  )
}

export const NO_CONTEXT_LIMIT = Number.MAX_SAFE_INTEGER
const CONTEXT_STEPS = [NO_CONTEXT_LIMIT, 50, 20, 10, 4, 0]
const INHERIT_CONTEXT_OPTION = 'inherit'

export function formatContextCount(value: number, t: (key: string) => string) {
  return value >= NO_CONTEXT_LIMIT ? t('No Limit') : `${value}`
}

/** Counts offered for the context limit, largest first; a stored count outside the steps stays selectable. */
function contextCountOptions(value: number) {
  return CONTEXT_STEPS.includes(value) ? CONTEXT_STEPS : [...CONTEXT_STEPS, value].sort((a, b) => b - a)
}

function ContextCountInput({
  value,
  onChange,
  testId,
  autoFocus = false,
}: {
  value?: number
  onChange(value: number): void
  testId?: string
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const density = useSettingsDensity()
  const { draft, setDraft, flush } = useFieldDraft<string | number>(
    value === undefined || value >= NO_CONTEXT_LIMIT ? '' : value,
    (next) => {
      if (next === '') return 'rejected'
      const count = Number(next)
      if (!Number.isSafeInteger(count) || count < 0 || count >= NO_CONTEXT_LIMIT) return 'rejected'
      if (count === value) return 'unchanged'
      onChange(count)
      return 'applied'
    }
  )
  return (
    <NumberInput
      data-testid={testId}
      aria-label={`${t('Context message limit')} · ${t('Custom')}`}
      placeholder={t('Custom') ?? ''}
      value={draft}
      onChange={setDraft}
      onBlur={flush}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      autoFocus={autoFocus}
      min={0}
      clampBehavior="none"
      allowDecimal={false}
      allowNegative={false}
      hideControls
      inputMode="numeric"
      enterKeyHint="done"
      size={density === 'touch' ? 'sm' : 'xs'}
      w={88}
      className="ms-auto shrink-0"
      classNames={{ input: '!text-center' }}
    />
  )
}

function NotRecommendedBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[11px] font-normal leading-none bg-chatbox-background-gray-secondary text-chatbox-tint-tertiary">
      {t('Not recommended')}
    </span>
  )
}

function ContextLimitLabel() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px] font-normal text-chatbox-tint-secondary">
      {t('Context message limit')}
      <NotRecommendedBadge />
    </span>
  )
}

/**
 * Global limit on earlier messages sent as context. Auto-compaction manages context, so the row
 * sits below the new-chat defaults in a subdued style and recommends No Limit.
 */
export function ContextLimitSettingRow({
  value,
  onChange,
  testId,
  inputTestId,
}: {
  value: number
  onChange(value: number): void
  testId?: string
  inputTestId?: string
}) {
  const { t } = useTranslation()
  const density = useSettingsDensity()
  return (
    <div className="settings-section-body flex flex-col min-w-0 rounded-xl border border-dashed border-chatbox-border-primary">
      <SettingRow
        id="max-context"
        label={<ContextLimitLabel />}
        description={t('Keep it at No Limit and let auto-compaction manage context')}
        controlLayout="block"
        control={
          <Flex gap="xs" align="center" wrap="wrap">
            <SegmentedControl
              data-testid={testId}
              aria-label={t('Context message limit') ?? undefined}
              size={density === 'touch' ? 'sm' : 'xs'}
              radius="md"
              fullWidth
              className="flex-1 min-w-[260px]"
              value={CONTEXT_STEPS.includes(value) ? `${value}` : ''}
              onChange={(next) => onChange(Number(next))}
              data={CONTEXT_STEPS.map((step) => ({ value: `${step}`, label: formatContextCount(step, t) }))}
            />
            <ContextCountInput value={value} onChange={onChange} testId={inputTestId} />
          </Flex>
        }
      />
    </div>
  )
}

/**
 * Conversation limit on earlier messages sent as context, shown as a small row under the model
 * parameters. The picker offers following the global value or an explicit count.
 */
export function ContextLimitSelectRow({
  value,
  inheritedValue,
  onChange,
  onInherit,
  selectTestId,
  inputTestId,
  testId,
}: {
  /** The conversation's own count, or undefined when it follows the global value. */
  value?: number
  inheritedValue: number
  onChange(value: number): void
  onInherit(): void
  selectTestId?: string
  inputTestId?: string
  testId?: string
}) {
  const { t } = useTranslation()
  const density = useSettingsDensity()
  const selectId = useId()
  const fontSize = density === 'touch' ? 13 : 12
  const [customOpen, setCustomOpen] = useState(false)
  useEffect(() => {
    if (value === undefined || CONTEXT_STEPS.includes(value)) setCustomOpen(false)
  }, [value])
  const showCustom = customOpen || (value !== undefined && !CONTEXT_STEPS.includes(value))
  return (
    <div
      data-testid={testId}
      data-inherit-state={value === undefined ? 'inherited' : 'overridden'}
      className={clsx(
        'flex flex-wrap items-center gap-1.5 px-1 text-chatbox-tint-tertiary',
        density === 'touch' ? 'min-h-11' : 'min-h-7'
      )}
      style={{ fontSize }}
    >
      <label htmlFor={selectId} className="min-w-0 truncate cursor-pointer">
        {t('Context message limit')}
      </label>
      <NotRecommendedBadge />
      <Select
        id={selectId}
        data-testid={selectTestId}
        variant="unstyled"
        size={density === 'touch' ? 'sm' : 'xs'}
        w={160}
        className="ms-auto shrink-0 max-w-full"
        allowDeselect={false}
        comboboxProps={{ withinPortal: false }}
        value={customOpen ? 'custom' : value === undefined ? INHERIT_CONTEXT_OPTION : `${value}`}
        onChange={(next) => {
          if (next === null) return
          if (next === 'custom') {
            setCustomOpen(true)
            return
          }
          setCustomOpen(false)
          if (next === INHERIT_CONTEXT_OPTION) onInherit()
          else onChange(Number(next))
        }}
        data={[
          {
            value: INHERIT_CONTEXT_OPTION,
            label: `${t('Follows global')} · ${formatContextCount(inheritedValue, t)}`,
          },
          ...contextCountOptions(value ?? inheritedValue).map((step) => ({
            value: `${step}`,
            label: formatContextCount(step, t),
          })),
          { value: 'custom', label: t('Custom') },
        ]}
        rightSection={<ScalableIcon icon={IconSelector} size={12} className="text-inherit" />}
        rightSectionWidth={16}
        rightSectionPointerEvents="none"
        styles={{
          input: {
            fontSize,
            height: 'auto',
            minHeight: density === 'touch' ? 36 : 24,
            paddingLeft: 0,
            paddingRight: 16,
            textAlign: 'right',
            textAlignLast: 'right',
            color: 'var(--chatbox-tint-secondary)',
            cursor: 'pointer',
          },
        }}
      />
      {showCustom && (
        <div className="flex w-full justify-end pb-1">
          <ContextCountInput
            value={(value ?? inheritedValue) >= NO_CONTEXT_LIMIT ? undefined : (value ?? inheritedValue)}
            onChange={onChange}
            testId={inputTestId}
            autoFocus={customOpen}
          />
        </div>
      )}
    </div>
  )
}

/** Value summary used by inheritance labels, such as "Model default" for an unset temperature. */
export function describeSamplingValue(value: number | undefined, t: (key: string) => string) {
  return value === undefined ? t('Model default') : `${value}`
}
