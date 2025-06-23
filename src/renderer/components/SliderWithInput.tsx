import { ChangeEvent, KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { Flex, Input, Slider, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'

export type Props = {
  value?: number
  onChange(value?: number): void
  min?: number
  max?: number
  step?: number
  className?: string
}

// SliderChangeEnd触发 或者 input blur的时候才触发onChange
export default function SliderWithInput({ value, onChange, min = 0, max = 1, step = 0.01, className }: Props) {
  const { t } = useTranslation()
  const [tempSliderValue, setTempSliderValue] = useState<number>()
  const sliderValue = useMemo(() => tempSliderValue ?? value ?? 0, [tempSliderValue, value])
  const handleSliderChange = useCallback((v: number) => {
    setTempSliderValue(v)
  }, [])
  const handleSliderChangeEnd = useCallback((v: number) => {
    // 有概率会出现SliderChangeEnd事件之后又产生一个SliderChange，所以延时处理
    setTimeout(() => {
      setTempSliderValue(undefined)
      onChange?.(v)
    }, 100)
  }, [])

  const [tempInputValue, setTempInputValue] = useState<string>()
  const inputValue = useMemo(
    () => tempInputValue ?? tempSliderValue ?? value ?? t('Not set'),
    [tempInputValue, tempSliderValue, value]
  )
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
  }, [tempInputValue, min, max])
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
        w={56}
        size="sm"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyUp={handleInputKeyUp}
        classNames={{
          input: '!text-center !px-0',
        }}
      />
    </Flex>
  )
}
