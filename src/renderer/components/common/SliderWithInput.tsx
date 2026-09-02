import { CloseButton, Flex, Slider, Text, TextInput } from '@mantine/core'
import clsx from 'clsx'
import { type ChangeEvent, type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type Props = {
  value?: number
  onChange(value?: number): void
  min?: number
  max?: number
  step?: number
  className?: string
  suffix?: string
  inputTestId?: string
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
}: Props) {
  const { t } = useTranslation()
  const [tempSliderValue, setTempSliderValue] = useState<number>()
  const sliderValue = useMemo(() => tempSliderValue ?? value ?? 0, [tempSliderValue, value])
  const handleSliderChange = useCallback((v: number) => {
    setTempSliderValue(v)
  }, [])
  const handleSliderChangeEnd = useCallback(
    (v: number) => {
      // 有概率会出现SliderChangeEnd事件之后又产生一个SliderChange，所以延时处理
      setTimeout(() => {
        setTempSliderValue(undefined)
        onChange?.(v)
      }, 100)
    },
    [onChange]
  )

  const [tempInputValue, setTempInputValue] = useState<string>()
  const inputRawValue = useMemo(
    () => tempInputValue ?? tempSliderValue ?? value,
    [tempInputValue, tempSliderValue, value]
  )
  const inputValue = useMemo(() => (inputRawValue === undefined ? '' : `${inputRawValue}`), [inputRawValue])
  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value
    setTempInputValue(v)
  }, [])
  const handleInputBlur = useCallback(() => {
    if (tempInputValue) {
      const v = parseFloat(tempInputValue)
      if (v >= min && v <= max) {
        onChange?.(v)
      }
    }
    setTempInputValue(undefined)
  }, [tempInputValue, min, max, onChange])
  const handleInputKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])

  return (
    <Flex gap="sm" align="center" className={className}>
      <Slider
        flex={1}
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={handleSliderChange}
        onChangeEnd={handleSliderChangeEnd}
      />
      <TextInput
        data-testid={inputTestId}
        w={64}
        size="sm"
        placeholder={t('Not set') || ''}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={handleInputBlur}
        onKeyUp={handleInputKeyUp}
        enterKeyHint="send"
        classNames={{
          input: clsx(
            '!text-center !px-0',
            suffix || typeof inputRawValue === 'string' || inputRawValue === undefined ? '!pr-4' : ''
          ),
        }}
        rightSection={
          suffix ? (
            <Text size="sm" c="chatbox-secondary">
              {suffix}
            </Text>
          ) : typeof inputRawValue === 'string' || inputRawValue === undefined ? null : (
            <CloseButton size="xs" onClick={() => onChange?.()} />
          )
        }
      />
    </Flex>
  )
}
