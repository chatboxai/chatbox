import { ActionIcon, Box, Button, Flex, SimpleGrid, Stack, TextInput, UnstyledButton } from '@mantine/core'
import {
  getDefaultInterfaceColors,
  INTERFACE_COLOR_PRESETS,
  type InterfaceColorPreset,
  type InterfaceColors,
  type InterfaceThemeColors,
  isInterfaceBrandColorAllowed,
  resolveInterfaceBrandColor,
  resolveInterfaceBrandColors,
} from '@shared/theme-colors'
import { IconCheck, IconDeviceFloppy, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import clsx from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InterfaceColorInput } from '@/components/common/InterfaceColorInput'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

const dotButtonClassName =
  'relative flex size-7 items-center justify-center rounded-full transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.94] motion-reduce:transform-none motion-reduce:transition-none'

function sameColors(a: InterfaceColors, b: InterfaceColors) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Theme color presets as swatches: the selected one is ringed, names show on hover, and
 * "Custom…" opens the color editor for a new preset. Light and dark colors apply separately.
 */
export function InterfaceColorPresets() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const interfaceColors = useSettingsStore((state) => state.interfaceColors)
  const interfaceColorPresets = useSettingsStore((state) => state.interfaceColorPresets)
  const realTheme = useUIStore((state) => state.realTheme)
  const storedInterfaceColors = (interfaceColors ?? getDefaultInterfaceColors())[realTheme]
  const currentInterfaceColors = {
    ...storedInterfaceColors,
    brand: resolveInterfaceBrandColor(storedInterfaceColors.brand, realTheme),
  }
  const resolvedCurrentColors = resolveInterfaceBrandColors(interfaceColors ?? getDefaultInterfaceColors())
  const [isCreating, setIsCreating] = useState(false)
  const [isEditingPresets, setIsEditingPresets] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [presetLabel, setPresetLabel] = useState('')

  const updateCurrentInterfaceColors = (updater: (colors: InterfaceThemeColors) => InterfaceThemeColors) => {
    setSettings((draft) => {
      draft.interfaceColors ??= getDefaultInterfaceColors()
      draft.interfaceColors[realTheme] = updater(draft.interfaceColors[realTheme])
    })
  }

  const setInterfaceColor = (key: keyof InterfaceThemeColors, value: string) => {
    updateCurrentInterfaceColors((colors) => ({ ...colors, [key]: value }))
  }

  const applyPreset = (colors: InterfaceColors) => {
    setSettings((draft) => {
      draft.interfaceColors = resolveInterfaceBrandColors(colors)
    })
  }

  const cancelEditing = () => {
    setEditingPresetId(null)
    setIsCreating(false)
    setPresetLabel('')
  }

  const saveNewPreset = () => {
    const label = presetLabel.trim()
    if (!label) return
    setSettings((draft) => {
      const colors = resolveInterfaceBrandColors(draft.interfaceColors ?? getDefaultInterfaceColors())
      draft.interfaceColorPresets ??= []
      draft.interfaceColorPresets.push({
        id: crypto.randomUUID(),
        label,
        colors: { light: { ...colors.light }, dark: { ...colors.dark } },
      })
    })
    cancelEditing()
  }

  const saveEditedPreset = () => {
    const label = presetLabel.trim()
    if (!editingPresetId || !label) return
    setSettings((draft) => {
      const colors = resolveInterfaceBrandColors(draft.interfaceColors ?? getDefaultInterfaceColors())
      draft.interfaceColorPresets = (draft.interfaceColorPresets ?? []).map((preset) =>
        preset.id === editingPresetId
          ? { ...preset, label, colors: { light: { ...colors.light }, dark: { ...colors.dark } } }
          : preset
      )
    })
    cancelEditing()
  }

  const deletePreset = (presetId: string) => {
    setSettings((draft) => {
      draft.interfaceColorPresets = (draft.interfaceColorPresets ?? []).filter((preset) => preset.id !== presetId)
    })
    if (editingPresetId === presetId) cancelEditing()
  }

  const startEditingPreset = (preset: InterfaceColorPreset) => {
    applyPreset(preset.colors)
    setIsCreating(false)
    setEditingPresetId(preset.id)
    setPresetLabel(preset.label)
  }

  const presets = [
    ...INTERFACE_COLOR_PRESETS.map((preset) => ({
      ...preset,
      colors: resolveInterfaceBrandColors(preset.colors),
      isCustom: false,
    })),
    ...(interfaceColorPresets ?? []).map((preset) => ({
      ...preset,
      colors: resolveInterfaceBrandColors(preset.colors),
      isCustom: true,
    })),
  ] satisfies Array<InterfaceColorPreset & { isCustom: boolean }>
  const hasCustomPresets = (interfaceColorPresets?.length ?? 0) > 0

  return (
    <Stack gap="sm">
      <Flex gap={10} wrap="wrap" align="center">
        {presets.map((preset) => {
          const selected = sameColors(preset.colors, resolvedCurrentColors)
          const label = preset.isCustom ? preset.label : t(preset.label)
          return (
            <Box key={preset.id} pos="relative">
              <Tooltip label={label} withArrow>
                <UnstyledButton
                  aria-label={label}
                  aria-pressed={selected}
                  className={clsx(
                    dotButtonClassName,
                    selected
                      ? 'ring-2 ring-offset-2 ring-chatbox-border-brand ring-offset-chatbox-background-primary'
                      : ''
                  )}
                  style={{ backgroundColor: preset.colors[realTheme].brand }}
                  onClick={() => {
                    if (isEditingPresets && preset.isCustom) startEditingPreset(preset)
                    else applyPreset(preset.colors)
                  }}
                >
                  {selected && <IconCheck size={14} className="text-chatbox-tint-white" />}
                </UnstyledButton>
              </Tooltip>
              {isEditingPresets && preset.isCustom && (
                <ActionIcon
                  pos="absolute"
                  top={-6}
                  right={-6}
                  variant="filled"
                  color="chatbox-error"
                  size={16}
                  radius="xl"
                  aria-label={t('Delete') ?? undefined}
                  onClick={() => deletePreset(preset.id)}
                >
                  <IconTrash size={10} />
                </ActionIcon>
              )}
            </Box>
          )
        })}
        <Button
          variant="subtle"
          color="chatbox-gray"
          size="compact-sm"
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            setEditingPresetId(null)
            setPresetLabel(`Custom Preset ${(interfaceColorPresets?.length ?? 0) + 1}`)
            setIsCreating(true)
          }}
        >
          {t('Custom…')}
        </Button>
        {hasCustomPresets && (
          <Tooltip label={isEditingPresets ? t('Done') : t('Edit custom presets')} withArrow>
            <ActionIcon
              variant={isEditingPresets ? 'light' : 'subtle'}
              color="chatbox-gray"
              size="sm"
              aria-label={(isEditingPresets ? t('Done') : t('Edit custom presets')) ?? undefined}
              onClick={() => {
                if (isEditingPresets) cancelEditing()
                setIsEditingPresets((value) => !value)
              }}
            >
              {isEditingPresets ? <IconCheck size={14} /> : <IconPencil size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </Flex>
      {(isCreating || editingPresetId) && (
        <Stack gap="md" className="rounded-lg border border-solid border-chatbox-border-primary p-3">
          <TextInput
            autoFocus
            size="sm"
            label={t('Name')}
            value={presetLabel}
            onChange={(event) => setPresetLabel(event.currentTarget.value)}
          />
          <SimpleGrid cols={2} spacing="md">
            <InterfaceColorInput
              label={t('Primary Background')}
              value={currentInterfaceColors.backgroundPrimary}
              onCommit={(value) => setInterfaceColor('backgroundPrimary', value)}
            />
            <InterfaceColorInput
              label={t('Secondary Background')}
              value={currentInterfaceColors.backgroundSecondary}
              onCommit={(value) => setInterfaceColor('backgroundSecondary', value)}
            />
            <InterfaceColorInput
              label={t('Tertiary Background')}
              value={currentInterfaceColors.backgroundTertiary}
              onCommit={(value) => setInterfaceColor('backgroundTertiary', value)}
            />
            <InterfaceColorInput
              label={t('Brand Color')}
              value={currentInterfaceColors.brand}
              isColorAllowed={isInterfaceBrandColorAllowed}
              onCommit={(value) => setInterfaceColor('brand', value)}
            />
          </SimpleGrid>
          <Flex gap="sm" justify="flex-end" wrap="wrap">
            <Button
              variant="subtle"
              color="chatbox-gray"
              size="xs"
              onClick={() => updateCurrentInterfaceColors(() => getDefaultInterfaceColors()[realTheme])}
            >
              {t('Reset Colors')}
            </Button>
            <Button variant="default" size="xs" onClick={cancelEditing}>
              {t('Cancel')}
            </Button>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              disabled={!presetLabel.trim()}
              onClick={editingPresetId ? saveEditedPreset : saveNewPreset}
            >
              {editingPresetId ? t('Save') : t('Save Preset')}
            </Button>
          </Flex>
        </Stack>
      )}
    </Stack>
  )
}
