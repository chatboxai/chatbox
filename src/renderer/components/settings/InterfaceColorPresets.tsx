import { Button, Flex, SimpleGrid, Stack, TextInput, UnstyledButton } from '@mantine/core'
import {
  getDefaultInterfaceColors,
  INTERFACE_COLOR_PRESETS,
  type InterfaceColorPreset,
  type InterfaceColors,
  type InterfaceTheme,
  type InterfaceThemeColors,
  isInterfaceBrandColorAllowed,
  resolveInterfaceBrandColor,
  resolveInterfaceBrandColors,
} from '@shared/theme-colors'
import { IconCheck, IconDeviceFloppy, IconPencil, IconPlus, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { type CSSProperties, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InterfaceColorInput } from '@/components/common/InterfaceColorInput'
import { SettingRow, useSettingsDensity } from '@/components/settings/SettingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'

function sameColors(a: InterfaceColors, b: InterfaceColors) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// A faint edge that keeps light or dark colors visible against the same page background.
function edgeShadow(theme: InterfaceTheme, lightAlpha: number, darkAlpha: number) {
  return theme === 'dark'
    ? `inset 0 0 0 1px color-mix(in srgb, var(--chatbox-tint-white) ${darkAlpha}%, transparent)`
    : `inset 0 0 0 1px color-mix(in srgb, var(--chatbox-tint-black) ${lightAlpha}%, transparent)`
}

function swatchStyle(brand: string, theme: InterfaceTheme): CSSProperties {
  return { backgroundColor: brand, boxShadow: edgeShadow(theme, 10, 14) }
}

/** A thumbnail chat screen painted with one theme's backgrounds and brand color. */
function InterfaceColorPreview({ colors, theme }: { colors: InterfaceThemeColors; theme: InterfaceTheme }) {
  const { t } = useTranslation()
  return (
    <div
      role="img"
      aria-label={t('Preview') ?? undefined}
      data-testid="interface-color-preview"
      className="flex aspect-[16/10] w-32 shrink-0 overflow-hidden rounded-lg"
      style={
        {
          '--preview-bg-1': colors.backgroundPrimary,
          '--preview-bg-2': colors.backgroundSecondary,
          '--preview-bg-3': colors.backgroundTertiary,
          '--preview-brand': colors.brand,
          backgroundColor: 'var(--preview-bg-1)',
          boxShadow: edgeShadow(theme, 6, 8),
        } as CSSProperties
      }
    >
      <div className="flex w-[26%] flex-col gap-[3px] bg-[var(--preview-bg-2)] px-1 py-1.5">
        <i className="block h-[3px] rounded-sm bg-[color-mix(in_srgb,var(--preview-brand),transparent_70%)]" />
        <i className="block h-[3px] rounded-sm bg-[var(--preview-bg-3)]" />
        <i className="block h-[3px] rounded-sm bg-[var(--preview-bg-3)]" />
      </div>
      <div className="flex flex-1 flex-col gap-1 px-1.5 pb-[5px] pt-[7px]">
        <span className="h-[7px] w-[46%] self-end rounded bg-[var(--preview-brand)]" />
        <span className="h-[7px] w-[70%] rounded bg-[var(--preview-bg-3)]" />
        <span className="h-[7px] w-[48%] rounded bg-[var(--preview-bg-3)]" />
        <span className="mt-auto flex h-[9px] justify-end rounded-[5px] bg-[var(--preview-bg-2)] p-0.5">
          <b className="size-[5px] rounded-full bg-[var(--preview-brand)]" />
        </span>
      </div>
    </div>
  )
}

/**
 * The theme color setting: every preset is a chip with its brand color and full name, the
 * selected one outlined in the brand color. "Custom…" opens the color editor for a new preset,
 * and edit mode lets custom presets be changed or deleted. Light and dark colors apply separately.
 */
export function InterfaceColorPresets() {
  const { t } = useTranslation()
  const touch = useSettingsDensity() === 'touch'
  const idPrefix = useId()
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
  // Colors still being picked or typed in the editor; the preview shows them before they commit.
  const [colorDraft, setColorDraft] = useState<{ theme: InterfaceTheme; colors: Partial<InterfaceThemeColors> }>({
    theme: realTheme,
    colors: {},
  })
  // Switching between light and dark resets the color inputs to that theme's stored colors, so
  // drafts picked in the other theme are dropped.
  if (colorDraft.theme !== realTheme) setColorDraft({ theme: realTheme, colors: {} })
  const draftColors = colorDraft.theme === realTheme ? colorDraft.colors : {}
  const clearDraftColors = () => setColorDraft({ theme: realTheme, colors: {} })

  const updateCurrentInterfaceColors = (updater: (colors: InterfaceThemeColors) => InterfaceThemeColors) => {
    setSettings((draft) => {
      draft.interfaceColors ??= getDefaultInterfaceColors()
      draft.interfaceColors[realTheme] = updater(draft.interfaceColors[realTheme])
    })
    clearDraftColors()
  }

  const setInterfaceColor = (key: keyof InterfaceThemeColors, value: string) => {
    updateCurrentInterfaceColors((colors) => ({ ...colors, [key]: value }))
  }

  const setDraftColor = (key: keyof InterfaceThemeColors, value: string) => {
    setColorDraft((current) => ({ theme: realTheme, colors: { ...current.colors, [key]: value } }))
  }

  const applyPreset = (colors: InterfaceColors) => {
    setSettings((draft) => {
      draft.interfaceColors = resolveInterfaceBrandColors(colors)
    })
    clearDraftColors()
  }

  const cancelEditing = () => {
    setEditingPresetId(null)
    setIsCreating(false)
    setPresetLabel('')
    clearDraftColors()
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
    const remainingPresets = (interfaceColorPresets ?? []).filter((preset) => preset.id !== presetId)
    setSettings((draft) => {
      draft.interfaceColorPresets = (draft.interfaceColorPresets ?? []).filter((preset) => preset.id !== presetId)
    })
    if (editingPresetId === presetId) cancelEditing()
    // With no custom presets left there is nothing to edit; a preset created later starts outside edit mode.
    if (remainingPresets.length === 0) setIsEditingPresets(false)
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

  const chipClassName = clsx(
    'inline-flex max-w-full items-center rounded-full border border-solid',
    touch ? 'min-h-[38px]' : 'min-h-8'
  )
  // Buttons set their own font size, so the chip text size goes on them.
  const chipTextClassName = touch ? 'text-sm leading-5' : 'text-[13px] leading-[18px]'

  const editToggle = hasCustomPresets && (
    <UnstyledButton
      aria-label={isEditingPresets ? undefined : (t('Edit custom presets') ?? undefined)}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 text-[13px]',
        touch ? 'h-8' : 'h-7',
        isEditingPresets
          ? 'bg-chatbox-background-brand-secondary text-chatbox-tint-brand'
          : 'text-chatbox-tint-secondary hover:bg-chatbox-background-gray-secondary'
      )}
      onClick={() => {
        if (isEditingPresets) cancelEditing()
        setIsEditingPresets(!isEditingPresets)
      }}
    >
      {isEditingPresets ? <IconCheck size={16} /> : <IconPencil size={16} />}
      {isEditingPresets ? t('Done') : t('Edit')}
    </UnstyledButton>
  )

  const previewColors = { ...currentInterfaceColors, ...draftColors }

  const control = (
    <Stack gap={0}>
      <Flex gap={8} wrap="wrap">
        {presets.map((preset) => {
          const selected = sameColors(preset.colors, resolvedCurrentColors)
          const label = preset.isCustom ? preset.label : t(preset.label)
          const muted = isEditingPresets && !preset.isCustom
          const editable = isEditingPresets && preset.isCustom
          const nameId = `${idPrefix}-${preset.id}`
          return (
            <div
              key={preset.id}
              className={clsx(
                chipClassName,
                selected
                  ? 'border-chatbox-border-brand bg-chatbox-background-brand-secondary'
                  : 'border-chatbox-border-primary bg-chatbox-background-primary',
                editingPresetId === preset.id &&
                  'border-chatbox-border-brand shadow-[0_0_0_3px_var(--chatbox-background-brand-secondary)]',
                muted && 'opacity-[0.45]'
              )}
            >
              <UnstyledButton
                aria-label={label}
                aria-pressed={selected}
                disabled={muted}
                className={clsx(
                  'inline-flex min-w-0 items-center gap-2 rounded-full py-1.5 pe-3 ps-[7px] text-start text-chatbox-tint-primary disabled:cursor-default',
                  chipTextClassName,
                  selected && 'font-medium'
                )}
                onClick={() => {
                  if (editable) startEditingPreset(preset)
                  else applyPreset(preset.colors)
                }}
              >
                <span
                  className="size-[18px] shrink-0 rounded-full"
                  style={swatchStyle(preset.colors[realTheme].brand, realTheme)}
                />
                <span id={nameId} className="[overflow-wrap:anywhere] [word-break:keep-all]">
                  {label}
                </span>
                {editable ? (
                  <IconPencil size={16} className="shrink-0 text-chatbox-tint-tertiary" />
                ) : (
                  selected && <IconCheck size={16} className="-ms-0.5 shrink-0 text-chatbox-tint-brand" />
                )}
              </UnstyledButton>
              {editable && (
                <UnstyledButton
                  aria-label={t('Delete') ?? undefined}
                  aria-describedby={nameId}
                  className="-ms-1 me-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-full text-chatbox-tint-tertiary hover:bg-chatbox-background-gray-secondary hover:text-chatbox-tint-error"
                  onClick={() => deletePreset(preset.id)}
                >
                  <IconX size={16} />
                </UnstyledButton>
              )}
            </div>
          )
        })}
        {!isEditingPresets && (
          <div className={clsx(chipClassName, 'border-dashed border-chatbox-border-primary')}>
            <UnstyledButton
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full py-1.5 pe-3 ps-2.5 text-chatbox-tint-secondary',
                chipTextClassName
              )}
              onClick={() => {
                setEditingPresetId(null)
                setPresetLabel(`Custom Preset ${(interfaceColorPresets?.length ?? 0) + 1}`)
                clearDraftColors()
                setIsCreating(true)
              }}
            >
              <IconPlus size={16} className="shrink-0" />
              {t('Custom…')}
            </UnstyledButton>
          </div>
        )}
      </Flex>
      {(isCreating || editingPresetId) && (
        <Stack
          gap="md"
          mt="sm"
          className={clsx(
            'rounded-lg border border-solid border-chatbox-border-primary p-3',
            !touch && 'max-w-[560px]'
          )}
        >
          <Flex gap="md" align="flex-end" wrap="wrap">
            <InterfaceColorPreview colors={previewColors} theme={realTheme} />
            <TextInput
              autoFocus
              size="sm"
              label={t('Name')}
              value={presetLabel}
              onChange={(event) => setPresetLabel(event.currentTarget.value)}
              className="min-w-[200px] flex-1"
            />
          </Flex>
          {/* Remounted per theme so a half-picked color from the other theme does not linger. */}
          <SimpleGrid key={realTheme} cols={2} spacing="md">
            <InterfaceColorInput
              label={t('Primary Background')}
              value={currentInterfaceColors.backgroundPrimary}
              onCommit={(value) => setInterfaceColor('backgroundPrimary', value)}
              onDraftChange={(value) => setDraftColor('backgroundPrimary', value)}
            />
            <InterfaceColorInput
              label={t('Secondary Background')}
              value={currentInterfaceColors.backgroundSecondary}
              onCommit={(value) => setInterfaceColor('backgroundSecondary', value)}
              onDraftChange={(value) => setDraftColor('backgroundSecondary', value)}
            />
            <InterfaceColorInput
              label={t('Tertiary Background')}
              value={currentInterfaceColors.backgroundTertiary}
              onCommit={(value) => setInterfaceColor('backgroundTertiary', value)}
              onDraftChange={(value) => setDraftColor('backgroundTertiary', value)}
            />
            <InterfaceColorInput
              label={t('Brand Color')}
              value={currentInterfaceColors.brand}
              isColorAllowed={isInterfaceBrandColorAllowed}
              onCommit={(value) => setInterfaceColor('brand', value)}
              onDraftChange={(value) => setDraftColor('brand', value)}
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

  return (
    // biome-ignore lint/nursery/useUniqueElementIds: Setting ids are stable settings-search anchors.
    <SettingRow
      id="theme-color"
      label={t('Theme color')}
      description={t('Light and dark themes keep their own colors')}
      controlLayout="block"
      labelAction={editToggle}
      control={control}
    />
  )
}
