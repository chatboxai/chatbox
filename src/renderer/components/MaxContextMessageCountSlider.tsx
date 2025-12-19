import { Flex, Slider, Stack, type StackProps, Text, TextInput, type TextProps, Tooltip } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { type ChangeEvent, type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from './ScalableIcon'

export function toBeRemoved_getContextMessageCount(
  openaiMaxContextMessageCount: number,
  maxContextMessageCount?: number
) {
  return typeof maxContextMessageCount === 'number'
    ? maxContextMessageCount
    : openaiMaxContextMessageCount > 20
      ? Number.MAX_SAFE_INTEGER
      : openaiMaxContextMessageCount
}

export interface Props {
  value: number
  onChange(value: number): void
  className?: string
  wrapperProps?: StackProps
  labelProps?: TextProps
}

const MESSAGE_COUNT_OPTIONS = [0, 2, 4, 6, 8, 10, 20, 50, 100, 200, 500, Number.MAX_SAFE_INTEGER]
export default function MaxContextMessageCountSlider({ value, onChange, className, wrapperProps, labelProps }: Props) {
  const { t } = useTranslation()

  const [tempSliderValue, setTempSliderValue] = useState<number>()
  const sliderValue = useMemo(() => {
    if (typeof tempSliderValue === 'number') {
      return tempSliderValue
    } else {
      if (value < 0) {
        return 0
      } else if (MESSAGE_COUNT_OPTIONS.includes(value)) {
        return MESSAGE_COUNT_OPTIONS.indexOf(value)
      } else {
        const i = MESSAGE_COUNT_OPTIONS.findLastIndex((v) => v < value)
        return (value - MESSAGE_COUNT_OPTIONS[i]) / (MESSAGE_COUNT_OPTIONS[i + 1] - MESSAGE_COUNT_OPTIONS[i]) + i
      }
    }
  }, [tempSliderValue, value])
  const handleSliderChange = useCallback((v: number) => {
    setTempSliderValue(v)
  }, [])
  const handleSliderChangeEnd = useCallback(
    (v: number) => {
      // 有概率会出现SliderChangeEnd事件之后又产生一个SliderChange，所以延时处理
      setTimeout(() => {
        setTempSliderValue(undefined)
        onChange?.(MESSAGE_COUNT_OPTIONS[v])
      }, 100)
    },
    [onChange]
  )

  const [tempInputValue, setTempInputValue] = useState<string>()
  const inputValue = useMemo(() => {
    if (typeof tempInputValue === 'string') {
      return tempInputValue
    }
    const v = typeof tempSliderValue === 'number' ? MESSAGE_COUNT_OPTIONS[tempSliderValue] : value
    return `${v === Number.MAX_SAFE_INTEGER ? t('No Limit') : v}`
  }, [tempInputValue, value, tempSliderValue, t])
  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value
    setTempInputValue(v)
  }, [])
  const handleInputBlur = useCallback(() => {
    if (tempInputValue) {
      const v = parseInt(tempInputValue)
      if (v >= 0) {
        onChange?.(v)
      }
    }
    setTempInputValue(undefined)
  }, [tempInputValue, onChange])
  const handleInputKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])

  return (
    <Stack gap="xs" {...wrapperProps}>
      <Flex align="center" gap="xs">
        <Text size="sm" fw={'600'} {...labelProps}>
          {t('Max Message Count in Context')}
        </Text>
        <Tooltip
          label={t(
            'Regulate the volume of historical messages sent to the AI, striking a harmonious balance between depth of comprehension and the efficiency of responses.'
          )}
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>
      <Flex gap="sm" align="center" className={className}>
        <Slider
          flex={1}
          step={1}
          min={0}
          max={MESSAGE_COUNT_OPTIONS.length - 1}
          label={(v) => {
            if (v === MESSAGE_COUNT_OPTIONS.indexOf(Number.MAX_SAFE_INTEGER)) {
              return t('No Limit')
            }
            return MESSAGE_COUNT_OPTIONS[v] ?? value
          }}
          marks={Array.from({ length: MESSAGE_COUNT_OPTIONS.length }).map((_, i) => ({ value: i }))}
          value={sliderValue}
          onChange={handleSliderChange}
          onChangeEnd={handleSliderChangeEnd}
        />
        <TextInput
          w={64}
          size="sm"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={(e) => e.currentTarget.select()}
          onKeyUp={handleInputKeyUp}
          classNames={{
            input: '!text-center !px-0',
          }}
        />
      </Flex>
    </Stack>
  )
}
