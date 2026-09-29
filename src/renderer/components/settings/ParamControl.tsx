import { Flex, NumberInput, SegmentedControl, Stack } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SliderWithInput from '@/components/common/SliderWithInput'
import { useFieldDraft } from '@/hooks/useFieldDraft'
import { useSettingsDensity } from './SettingsLayout'

const TEMPERATURE_PRESETS = [
  { key: 'precise', label: 'Precise', value: 0.3 },
  { key: 'balanced', label: 'Balanced', value: 1 },
  { key: 'creative', label: 'Creative', value: 1.5 },
] as const

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
}: {
  kind: 'temperature' | 'topP'
  value?: number
  onChange(value?: number): void
  inputTestId?: string
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

  if (density !== 'touch' || kind !== 'temperature') return slider

  return (
    <Stack gap="xs">
      <SegmentedControl
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
const CONTEXT_STEPS = [0, 4, 10, 20, 50, NO_CONTEXT_LIMIT]
const TOUCH_CONTEXT_STEPS = [0, 10, 20, 50, NO_CONTEXT_LIMIT]

export function formatContextCount(value: number, t: (key: string) => string) {
  return value >= NO_CONTEXT_LIMIT ? t('No Limit') : `${value}`
}

/**
 * Number of earlier messages sent as context: common counts as one tap, any other count in the
 * number field (a stepper on touch screens).
 */
export function ContextCountControl({
  value,
  onChange,
  inputTestId,
}: {
  value: number
  onChange(value: number): void
  inputTestId?: string
}) {
  const { t } = useTranslation()
  const density = useSettingsDensity()
  const steps = density === 'touch' ? TOUCH_CONTEXT_STEPS : CONTEXT_STEPS
  const { draft, setDraft, flush } = useFieldDraft<string | number>(value >= NO_CONTEXT_LIMIT ? '' : value, (next) => {
    const count = typeof next === 'number' ? next : Number.parseInt(next, 10)
    if (!Number.isFinite(count) || count < 0) return 'rejected'
    if (count === value) return 'unchanged'
    onChange(count)
    return 'applied'
  })

  return (
    <Flex gap="xs" align="center" wrap="wrap">
      <SegmentedControl
        size={density === 'touch' ? 'sm' : 'xs'}
        radius="md"
        className="flex-1 min-w-0"
        fullWidth
        value={steps.includes(value) ? `${value}` : ''}
        onChange={(next) => onChange(Number(next))}
        data={steps.map((step) => ({ value: `${step}`, label: formatContextCount(step, t) }))}
      />
      <NumberInput
        data-testid={inputTestId}
        w={density === 'touch' ? 96 : 72}
        size={density === 'touch' ? 'sm' : 'xs'}
        min={0}
        allowDecimal={false}
        allowNegative={false}
        hideControls={density !== 'touch'}
        placeholder={t('No Limit') ?? ''}
        aria-label={t('Context messages') ?? undefined}
        value={draft}
        onChange={setDraft}
        onBlur={flush}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        inputMode="numeric"
        enterKeyHint="done"
        classNames={{ input: '!text-center' }}
      />
    </Flex>
  )
}

/** Value summary used by inheritance labels, such as "Model default" for an unset temperature. */
export function describeSamplingValue(value: number | undefined, t: (key: string) => string) {
  return value === undefined ? t('Model default') : `${value}`
}
