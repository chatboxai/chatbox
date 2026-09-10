import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon, type AppIconName, canChangeAppIcon } from '@/platform/app-icon'
import defaultIcon from '@/static/app-icons/default.png'
import flatGradientIcon from '@/static/app-icons/flat-gradient.png'
import sculptedIcon from '@/static/app-icons/sculpted.png'

export function AppIconPicker() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [supported, setSupported] = useState(false)
  const [pending, setPending] = useState<AppIconName | null>(null)
  const [error, setError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const changing = useRef(false)

  useEffect(() => {
    if (!canChangeAppIcon()) return
    let active = true
    setError(false)
    AppIcon.getIcon()
      .then((state) => {
        if (!active) return
        setSupported(state.supported)
        setSelected(state.icon)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [loadAttempt])

  const changeIcon = async (icon: AppIconName) => {
    if (changing.current || icon === selected) return
    changing.current = true
    setPending(icon)
    setError(false)
    try {
      await AppIcon.setIcon({ icon })
      const state = await AppIcon.getIcon()
      setSelected(state.icon)
    } catch {
      setError(true)
    } finally {
      changing.current = false
      setPending(null)
    }
  }

  if (!canChangeAppIcon() || (!supported && !error)) return null

  return (
    <Stack gap="xs">
      <Text size="sm">{t('App icon')}</Text>
      {supported && (
        <Group gap="sm" role="group" aria-label={t('App icon') || undefined}>
          {(
            [
              { name: 'default', label: t('Classic'), image: defaultIcon },
              { name: 'FlatGradient', label: t('Flat gradient'), image: flatGradientIcon },
              { name: 'Sculpted', label: t('Sculpted'), image: sculptedIcon },
            ] as const
          ).map(({ name, label, image }) => (
            <Button
              key={name}
              variant={selected === name ? 'light' : 'default'}
              aria-pressed={selected === name}
              disabled={pending !== null}
              loading={pending === name}
              h="auto"
              py="sm"
              onClick={() => void changeIcon(name)}
            >
              <Stack gap="xs" align="center">
                <img src={image} alt="" width={56} height={56} style={{ borderRadius: 12 }} />
                <Text size="sm">{label}</Text>
              </Stack>
            </Button>
          ))}
        </Group>
      )}
      {error && (
        <Alert color="red">
          {t('Unable to change the app icon. Please try again.')}
          {!supported && (
            <Button variant="subtle" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              {t('Retry')}
            </Button>
          )}
        </Alert>
      )}
    </Stack>
  )
}
