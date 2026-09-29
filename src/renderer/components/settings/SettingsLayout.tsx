import { Switch, Text, UnstyledButton } from '@mantine/core'
import { IconArrowBackUp } from '@tabler/icons-react'
import clsx from 'clsx'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createStore, useStore } from 'zustand'
import { ICON_STROKE_WIDTH } from '@/components/common/IconButton'
import { ScalableIcon } from '@/components/common/ScalableIcon'

/**
 * Row density of the three containers that host settings:
 * - `comfortable`: settings pages, label column beside the control when the section is at least 560px wide
 * - `compact`: the conversation side panel, stacked below 560px
 * - `touch`: small screens, 44px rows and touch-sized controls
 */
export type SettingsDensity = 'comfortable' | 'compact' | 'touch'

const SettingsDensityContext = createContext<SettingsDensity>('comfortable')

export function SettingsDensityProvider({ density, children }: { density: SettingsDensity; children: ReactNode }) {
  return <SettingsDensityContext.Provider value={density}>{children}</SettingsDensityContext.Provider>
}

export function useSettingsDensity() {
  return useContext(SettingsDensityContext)
}

/** Row a settings search result jumps to; the row scrolls into view and flashes once. */
export const settingsHighlightStore = createStore<{ id: string | null; highlight: (id: string) => void }>((set) => ({
  id: null,
  highlight: (id) => set({ id }),
}))

/** Page title (20/600) with a one-line description. */
export function SettingsPage({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  const density = useSettingsDensity()
  return (
    <div
      className={clsx(
        'flex flex-col gap-6 mx-auto w-full max-w-[760px]',
        density === 'touch' ? 'px-3 py-4' : 'px-6 py-6',
        className
      )}
    >
      {density !== 'touch' && (
        <div className="flex flex-col gap-1">
          <Text component="h2" m={0} fz={20} fw={600} lh="28px">
            {title}
          </Text>
          {description && (
            <Text fz={13} c="chatbox-tertiary" lh="20px">
              {description}
            </Text>
          )}
        </div>
      )}
      {density === 'touch' && description && (
        <Text fz={13} c="chatbox-tertiary" lh="20px" px={4}>
          {description}
        </Text>
      )}
      {children}
    </div>
  )
}

/**
 * Titled group of settings rows. Rows sit in one bordered container separated by hairlines; the
 * optional action (such as "Restore all defaults") sits right of the title.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  tone,
  bare,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  /** `danger` outlines destructive groups such as restoring a backup. */
  tone?: 'danger'
  /** Renders rows without the bordered container, for panel content that is already framed. */
  bare?: boolean
}) {
  const density = useSettingsDensity()
  return (
    <section className="flex flex-col gap-2 min-w-0">
      {(title || action) && (
        <div className="flex items-center gap-2 min-h-6 px-1">
          <div className="flex flex-col flex-1 min-w-0">
            {title && (
              <Text
                component="h3"
                m={0}
                fz={density === 'compact' ? 12 : 14}
                fw={600}
                lh="20px"
                c={density === 'compact' ? 'chatbox-tertiary' : tone === 'danger' ? 'chatbox-error' : undefined}
              >
                {title}
              </Text>
            )}
            {description && (
              <Text fz={12} c="chatbox-tertiary" lh="18px">
                {description}
              </Text>
            )}
          </div>
          {action}
        </div>
      )}
      <div
        className={clsx(
          'settings-section-body flex flex-col min-w-0',
          !bare && 'border border-solid bg-chatbox-background-primary',
          !bare && (density === 'touch' ? 'rounded-xl' : 'rounded-2xl'),
          !bare && (tone === 'danger' ? 'border-chatbox-border-error' : 'border-chatbox-border-primary')
        )}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * One setting: label and a short description on the left, the control on the right.
 * `inline` controls (switches, buttons, value chips) stay on the right at any width; `block`
 * controls (sliders, text areas, segmented controls) move under the label when the section is
 * narrower than 560px.
 */
export function SettingRow({
  id,
  label,
  description,
  control,
  controlLayout = 'inline',
  status,
  children,
  disabled,
  testId,
}: {
  /** Anchor for settings search. */
  id?: string
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  controlLayout?: 'inline' | 'block'
  /** Inheritance state or value summary shown under the label. */
  status?: ReactNode
  /** Extra content under the row, such as an expanded editor. */
  children?: ReactNode
  disabled?: boolean
  testId?: string
}) {
  const density = useSettingsDensity()
  const ref = useRef<HTMLDivElement>(null)
  const highlightedId = useStore(settingsHighlightStore, (s) => s.id)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!id || highlightedId !== id) return
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(true)
    const timer = setTimeout(() => {
      setFlash(false)
      settingsHighlightStore.setState({ id: null })
    }, 1600)
    return () => clearTimeout(timer)
  }, [highlightedId, id])

  return (
    <div
      ref={ref}
      data-setting-id={id}
      data-testid={testId}
      data-density={density}
      data-layout={controlLayout}
      aria-disabled={disabled || undefined}
      className={clsx(
        'settings-row flex flex-col min-w-0 transition-colors duration-300',
        flash && 'bg-chatbox-background-brand-secondary',
        disabled && 'opacity-60'
      )}
    >
      <div className="settings-row-main">
        <div className="settings-row-label flex flex-col gap-0.5 min-w-0">
          <Text fz={density === 'compact' ? 13 : 14} fw={500} lh="20px" className="text-pretty">
            {label}
          </Text>
          {description && (
            <Text fz={12} c="chatbox-tertiary" lh="18px" className="text-pretty">
              {description}
            </Text>
          )}
          {status}
        </div>
        {control && <div className="settings-row-control min-w-0">{control}</div>}
      </div>
      {children}
    </div>
  )
}

/** Boolean setting that applies immediately; the switch sits right of the label at every width. */
export function SettingSwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
  status,
  switchTestId,
  indent,
}: {
  id?: string
  label: ReactNode
  description?: ReactNode
  checked: boolean | undefined
  onChange: (checked: boolean) => void
  disabled?: boolean
  status?: ReactNode
  switchTestId?: string
  /** Nests the row under the row above it, for settings that depend on it. */
  indent?: boolean
}) {
  const density = useSettingsDensity()
  return (
    <SettingRow
      id={id}
      label={indent ? <span className="ps-5 block">{label}</span> : label}
      description={description && indent ? <span className="ps-5 block">{description}</span> : description}
      status={status}
      disabled={disabled}
      control={
        <Switch
          data-testid={switchTestId}
          size={density === 'touch' ? 'lg' : 'md'}
          checked={!!checked}
          disabled={disabled}
          aria-label={typeof label === 'string' ? label : undefined}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      }
    />
  )
}

/**
 * Whether a conversation value follows the global default or overrides it. Overridden values
 * show a brand dot and a restore action; inherited ones show the value they follow.
 */
export function InheritState({
  overridden,
  inheritedValue,
  onRestore,
  testId,
}: {
  overridden: boolean
  inheritedValue: ReactNode
  onRestore: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  if (!overridden) {
    return (
      <Text fz={12} lh="18px" c="chatbox-tertiary" data-testid={testId} data-inherit-state="inherited">
        {t('Follows global')} · {inheritedValue}
      </Text>
    )
  }
  return (
    <span className="flex items-center gap-1.5 min-h-[18px]" data-testid={testId} data-inherit-state="overridden">
      <span className="inline-block size-1.5 rounded-full bg-chatbox-tint-brand" aria-hidden />
      <Text span fz={12} lh="18px" c="chatbox-brand">
        {t('Overridden')}
      </Text>
      <UnstyledButton
        onClick={onRestore}
        className="flex items-center gap-0.5 rounded px-1 text-xs leading-[18px] text-chatbox-tint-secondary hover:bg-chatbox-background-gray-secondary"
      >
        <ScalableIcon icon={IconArrowBackUp} size={12} strokeWidth={ICON_STROKE_WIDTH} />
        {t('Restore')}
      </UnstyledButton>
    </span>
  )
}
