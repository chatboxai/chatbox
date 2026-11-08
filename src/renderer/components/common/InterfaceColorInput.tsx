import { ColorInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'

function normalizeHexDraft(value: string): string {
  return `#${value
    .replace(/^#/, '')
    .replace(/[^0-9a-f]/gi, '')
    .slice(0, 6)}`
}

export function InterfaceColorInput({
  label,
  value,
  isColorAllowed,
  onCommit,
  onDraftChange,
}: {
  label: string
  value: string
  isColorAllowed?: (value: string) => boolean
  onCommit: (value: string) => void
  /** Called with each complete, allowed color while the value is still being picked or typed. */
  onDraftChange?: (value: string) => void
}) {
  const [draftValue, setDraftValue] = useState(value)
  const draftValueRef = useRef(value)
  const committedValueRef = useRef(value.toLowerCase())

  useEffect(() => {
    setDraftValue(value)
    draftValueRef.current = value
    committedValueRef.current = value.toLowerCase()
  }, [value])

  const updateDraftValue = (nextValue: string) => {
    draftValueRef.current = nextValue
    setDraftValue(nextValue)
    const normalizedValue = nextValue.toLowerCase()
    if (/^#[0-9a-f]{6}$/.test(normalizedValue) && (!isColorAllowed || isColorAllowed(normalizedValue))) {
      onDraftChange?.(normalizedValue)
    }
  }

  const commitValue = (nextValue: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(nextValue)) {
      updateDraftValue(value)
      return
    }

    const normalizedValue = nextValue.toLowerCase()
    if (isColorAllowed && !isColorAllowed(normalizedValue)) {
      updateDraftValue(value)
      return
    }

    updateDraftValue(normalizedValue)
    if (committedValueRef.current === normalizedValue) return

    committedValueRef.current = normalizedValue
    onCommit(normalizedValue)
  }

  const commitCompletedValue = (nextValue: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(draftValueRef.current)) return
    commitValue(nextValue)
  }

  return (
    <ColorInput
      label={label}
      value={draftValue}
      maxLength={7}
      onChange={(nextValue) => updateDraftValue(normalizeHexDraft(nextValue))}
      onChangeEnd={commitCompletedValue}
      onBlur={() => commitValue(draftValueRef.current)}
    />
  )
}
