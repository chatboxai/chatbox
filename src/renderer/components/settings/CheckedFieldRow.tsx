import { Anchor, Button, Flex, PasswordInput, Text, TextInput } from '@mantine/core'
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react'
import { type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingRow } from '@/components/settings/SettingsLayout'
import platform from '@/platform'

/**
 * A service credential or address, saved as typed, with a Check button that runs one request
 * against it. Editing the value clears the result, and a result for an edited value is dropped.
 */
export function CheckedFieldRow({
  id,
  label,
  description,
  value,
  onChange,
  secret,
  placeholder,
  check,
  failureMessage,
  getKeyUrl,
  getKeyLabel,
}: {
  id: string
  label: string
  description?: ReactNode
  value: string | undefined
  onChange: (value: string) => void
  secret?: boolean
  placeholder?: string
  /** Resolves when the service accepts the value. */
  check: (value: string) => Promise<unknown>
  failureMessage: string
  getKeyUrl?: string
  getKeyLabel?: string
}) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean>()
  const run = useRef(0)
  const Input = secret ? PasswordInput : TextInput

  return (
    <SettingRow
      id={id}
      label={label}
      description={
        description || getKeyUrl ? (
          <>
            {description}
            {description && getKeyUrl && ' '}
            {getKeyUrl && (
              <Anchor
                component="button"
                c="chatbox-brand"
                fz={12}
                lh="18px"
                onClick={() => platform.openLink(getKeyUrl)}
              >
                {getKeyLabel ?? t('Get API Key')}
              </Anchor>
            )}
          </>
        ) : undefined
      }
      controlLayout="block"
      control={(fieldId) => (
        <div className="flex flex-col gap-1.5">
          <Flex gap="xs" align="flex-start">
            <Input
              id={fieldId}
              flex={1}
              size="sm"
              aria-label={label}
              value={value ?? ''}
              placeholder={placeholder}
              error={available === false}
              onChange={(event) => {
                run.current += 1
                setChecking(false)
                setAvailable(undefined)
                onChange(event.currentTarget.value)
              }}
            />
            <Button
              variant="default"
              size="sm"
              loading={checking}
              disabled={!value?.trim()}
              onClick={async () => {
                const current = ++run.current
                setChecking(true)
                setAvailable(undefined)
                const ok = await check(value ?? '').then(
                  () => true,
                  () => false
                )
                if (current !== run.current) return
                setAvailable(ok)
                setChecking(false)
              }}
            >
              {t('Check')}
            </Button>
          </Flex>
          {available !== undefined && (
            <Flex align="center" gap={4}>
              {available ? (
                <IconCircleCheck size={14} className="text-chatbox-tint-success" />
              ) : (
                <IconCircleX size={14} className="text-chatbox-tint-error" />
              )}
              <Text fz={12} c={available ? 'chatbox-success' : 'chatbox-error'}>
                {available ? t('Connection successful!') : failureMessage}
              </Text>
            </Flex>
          )}
        </div>
      )}
    />
  )
}
