import { PasswordInput, type PasswordInputProps } from '@mantine/core'
import type { SavedSyncSecret } from '@shared/sync'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { readSavedSyncSecret } from '@/packages/sync/runtime'

interface Visibility {
  key: string
  savedValue?: string
  error?: boolean
}

export function SavedSyncSecretInput({
  saved,
  value,
  onChange,
  disabled,
  placeholder,
  ...props
}: PasswordInputProps & { saved?: SavedSyncSecret; value: string }) {
  const { t } = useTranslation()
  const key = JSON.stringify(saved ?? null)
  const [visibility, setVisibility] = useState<Visibility>()
  const current = !disabled && visibility?.key === key ? visibility : undefined

  useEffect(() => {
    setVisibility((previous) => (disabled || previous?.key !== key ? undefined : previous))
  }, [key, disabled])

  function changeVisibility(visible: boolean) {
    if (!visible) {
      setVisibility(undefined)
      return
    }
    const pending = { key }
    setVisibility(pending)
    if (!value && saved) {
      void readSavedSyncSecret(saved).then(
        (savedValue) => {
          setVisibility((state) => (state === pending ? { key, savedValue, error: !savedValue } : state))
        },
        () => {
          setVisibility((state) => (state === pending ? { key, error: true } : state))
        }
      )
    }
  }

  return (
    <PasswordInput
      {...props}
      autoComplete="off"
      disabled={disabled}
      value={value || current?.savedValue || ''}
      placeholder={saved ? '••••••••' : placeholder}
      description={saved ? t('Saved on this device') : undefined}
      error={current?.error ? t('Unable to read the saved credential.') : undefined}
      visible={Boolean(current)}
      onVisibilityChange={changeVisibility}
      visibilityToggleButtonProps={{
        'aria-label': current ? t('Hide credential') : t('Show credential'),
        tabIndex: 0,
      }}
      onChange={(event) => {
        if (current) setVisibility({ key })
        onChange?.(event)
      }}
    />
  )
}
