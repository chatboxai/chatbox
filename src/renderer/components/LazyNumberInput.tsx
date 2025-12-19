import { ActionIcon, CloseButton, Stack, TextInput } from '@mantine/core'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import clsx from 'clsx'
import { type ChangeEvent, type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type Props = {
  value?: number
  onChange(value?: number): void
  min?: number
  max?: number
  placeholder?: string
  className?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  width?: number | string
  disabled?: boolean
  allowDecimal?: boolean
  hideControls?: boolean
  step?: number
}

// LazyNumberInput: 只有在 input blur 或者按 Enter 键时才触发 onChange
export default function LazyNumberInput({
  value,
  onChange,
  min,
  max,
  placeholder,
  className,
  size = 'sm',
  width = 64,
  disabled = false,
  allowDecimal = true,
  hideControls = false,
  step = 1,
}: Props) {
  const { t } = useTranslation()

  const [tempInputValue, setTempInputValue] = useState<string>()

  const inputRawValue = useMemo(() => tempInputValue ?? value, [tempInputValue, value])

  const inputValue = useMemo(() => (inputRawValue === undefined ? '' : `${inputRawValue}`), [inputRawValue])

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value
    setTempInputValue(v)
  }, [])

  const handleInputBlur = useCallback(() => {
    if (tempInputValue === '') {
      onChange?.()
    } else if (tempInputValue) {
      const v = allowDecimal ? parseFloat(tempInputValue) : parseInt(tempInputValue)
      if (!Number.isNaN(v)) {
        // 检查范围限制
        let newValue = v
        if (min !== undefined && newValue < min) newValue = min
        if (max !== undefined && newValue > max) newValue = max
        onChange?.(newValue)
      }
    }
    setTempInputValue(undefined)
  }, [tempInputValue, min, max, allowDecimal, onChange])

  const handleInputKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])

  const handleClear = useCallback(() => {
    setTempInputValue(undefined)
    onChange?.()
  }, [onChange])

  const handleIncrement = useCallback(() => {
    const next = (value ?? (min ?? 0) - step) + step
    onChange?.(typeof max === 'number' && next > max ? max : next)
  }, [value, step, min, max, onChange])

  const handleDecrement = useCallback(() => {
    const next = (value ?? (max ?? 0) + step) - step
    onChange?.(typeof min === 'number' && next < min ? min : next)
  }, [value, step, min, max, onChange])

  return (
    <TextInput
      w={width}
      size={size}
      placeholder={placeholder || t('Not set') || ''}
      value={inputValue}
      onChange={handleInputChange}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={handleInputBlur}
      onKeyUp={handleInputKeyUp}
      disabled={disabled}
      className={className}
      classNames={{
        input: clsx('!px-1', typeof inputRawValue === 'string' || inputRawValue === undefined ? '!pr-4' : '!pr-8'),
      }}
      rightSectionProps={{
        className: '!w-auto',
      }}
      rightSection={
        <>
          {typeof inputRawValue === 'string' || inputRawValue === undefined ? null : (
            <CloseButton size="xs" c="chatbox-secondary" onClick={handleClear} />
          )}
          {hideControls ? null : (
            <Stack gap={0} className="border-0 border-l border-solid border-[var(--input-bd)] pr-px">
              <ActionIcon variant="transparent" size={16} onClick={handleIncrement} c="chatbox-secondary">
                <IconChevronUp />
              </ActionIcon>
              <ActionIcon variant="transparent" size={16} onClick={handleDecrement} c="chatbox-secondary">
                <IconChevronDown />
              </ActionIcon>
            </Stack>
          )}
        </>
      }
    />
  )
}
