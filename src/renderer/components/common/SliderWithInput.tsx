import { CloseButton, Flex, Slider, type SliderProps, Text, TextInput } from '@mantine/core'
import clsx from 'clsx'
import { type ChangeEvent, type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFieldDraft } from '@/hooks/useFieldDraft'

export type Props = {
  /** Id of the value field, for a label that names it. */
  inputId?: string
  value?: number
  onChange(value?: number): void
  min?: number
  max?: number
  step?: number
  className?: string
  suffix?: string
  inputTestId?: string
  /** Shown in the input while no value is set; defaults to "Model default". */
  placeholder?: string
  marks?: SliderProps['marks']
  /** Labels spread evenly under the track, from the minimum to the maximum. */
  scaleLabels?: string[]
  inputWidth?: number
  clearable?: boolean
  /** Allow touching the track to set a value on small screens. */
  allowTouchTrackInteraction?: boolean
}

// SliderChangeEnd触发 或者 input blur的时候才触发onChange
export default function SliderWithInput({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  className,
  suffix,
  inputTestId,
  placeholder,
  marks,
  scaleLabels,
  inputWidth = 64,
  clearable = true,
  allowTouchTrackInteraction = false,
  inputId,
}: Props) {
  const { t } = useTranslation()
  const [tempSliderValue, setTempSliderValue] = useState<number>()
  // A save can land after onChange returns (conversation settings write to storage first). The released value
  // stays on screen while `value` is still the one it replaced, instead of snapping back until the save lands.
  const [released, setReleased] = useState<{ value: number; replaced?: number }>()
  if (released && released.replaced !== value) setReleased(undefined)
  const releasedValue = released && released.replaced === value ? released.value : undefined
  const shownValue = tempSliderValue ?? releasedValue
  const sliderValue = useMemo(() => shownValue ?? value ?? min, [shownValue, value, min])
  const unset = value === undefined && shownValue === undefined
  const handleSliderChange = useCallback((v: number) => {
    setTempSliderValue(v)
  }, [])
  const handleSliderChangeEnd = useCallback(
    (v: number) => {
      // 有概率会出现SliderChangeEnd事件之后又产生一个SliderChange，所以延时处理
      setTimeout(() => {
        setTempSliderValue(undefined)
        setReleased({ value: v, replaced: value })
        onChange?.(v)
      }, 100)
    },
    [onChange, value]
  )

  const committedText = value === undefined ? '' : `${value}`
  const {
    draft: inputDraft,
    setDraft: setInputDraft,
    flush: flushInput,
  } = useFieldDraft(committedText, (next) => {
    const v = Number.parseFloat(next)
    if (!(v >= min && v <= max)) return 'rejected'
    if (v === value) return 'unchanged'
    onChange?.(v)
    return 'applied'
  })
  const editingInput = inputDraft !== committedText
  const inputValue = shownValue !== undefined ? `${shownValue}` : inputDraft
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setReleased(undefined)
      setInputDraft(e.currentTarget.value)
    },
    [setInputDraft]
  )
  const handleInputKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])

  return (
    <Flex gap="sm" align={scaleLabels ? 'flex-start' : 'center'} className={className}>
      <Flex direction="column" gap={4} flex={1} miw={0} pt={scaleLabels ? 14 : 0}>
        <Slider
          min={min}
          max={max}
          step={step}
          marks={marks}
          value={sliderValue}
          onChange={handleSliderChange}
          onChangeEnd={handleSliderChangeEnd}
          // An unset value has no position on the scale, so the thumb, filled track and filled
          // marks stay hidden instead of suggesting the minimum.
          classNames={{
            trackContainer: allowTouchTrackInteraction ? 'max-sm:!pointer-events-auto' : undefined,
            ...(unset
              ? {
                  thumb: '!opacity-0',
                  bar: '!opacity-0',
                  mark: '!border-chatbox-border-primary !bg-chatbox-background-primary',
                }
              : {}),
          }}
        />
        {scaleLabels && (
          <Flex justify="space-between" gap="xs">
            {scaleLabels.map((label) => (
              <Text key={label} fz={11} c="chatbox-tertiary" lh="14px">
                {label}
              </Text>
            ))}
          </Flex>
        )}
      </Flex>
      <TextInput
        id={inputId}
        data-testid={inputTestId}
        w={inputWidth}
        size="sm"
        placeholder={placeholder ?? t('Model default') ?? ''}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={flushInput}
        onKeyUp={handleInputKeyUp}
        inputMode="decimal"
        enterKeyHint="done"
        classNames={{
          input: clsx(
            '!text-center !px-0 placeholder:text-xs',
            suffix || editingInput || inputValue === '' ? '!pr-4' : ''
          ),
        }}
        rightSection={
          suffix ? (
            <Text size="sm" c="chatbox-secondary">
              {suffix}
            </Text>
          ) : !clearable || editingInput || inputValue === '' ? null : (
            <CloseButton size="xs" aria-label={t('Clear') ?? undefined} onClick={() => onChange?.()} />
          )
        }
      />
    </Flex>
  )
}
