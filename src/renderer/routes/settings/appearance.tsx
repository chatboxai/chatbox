import { Box, Button, FileButton, Flex, SegmentedControl, Slider, Text } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { type Language, Theme } from '@shared/types'
import { IconChevronRight } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AssistantAvatar, UserAvatar } from '@/components/common/Avatar'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SliderWithInput from '@/components/common/SliderWithInput'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import { useBackupOperationActive } from '@/components/settings/DataSections'
import { InterfaceColorPresets } from '@/components/settings/InterfaceColorPresets'
import { SettingRow, SettingsPage, SettingsSection, useSettingsDensity } from '@/components/settings/SettingsLayout'
import { languageNameMap, languages } from '@/i18n/locales'
import { canChangeAppIcon } from '@/platform/app-icon'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

export const Route = createFileRoute('/settings/appearance')({
  component: RouteComponent,
})

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_FONT_SIZE = 14

function ImageUploadButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const { t } = useTranslation()
  return (
    <FileButton
      accept="image/png,image/jpeg"
      onChange={(file) => {
        if (!file) return
        if (file.size > MAX_IMAGE_SIZE) {
          addToast(t('Support jpg or png file smaller than 5MB'))
          return
        }
        onFile(file)
      }}
    >
      {(props) => (
        <Button {...props} variant="default" size="xs">
          {label}
        </Button>
      )}
    </FileButton>
  )
}

function FontSizeControl({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const fontSize = useSettingsStore((s) => s.fontSize)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const [draft, setDraft] = useState(fontSize)
  useEffect(() => setDraft(fontSize), [fontSize])
  return (
    <Flex align="center" gap="sm">
      <Text fz={12} c="chatbox-tertiary" aria-hidden>
        A
      </Text>
      <Slider
        flex={1}
        step={1}
        min={10}
        max={22}
        marks={[{ value: DEFAULT_FONT_SIZE }]}
        value={draft}
        onChange={setDraft}
        onChangeEnd={(value) => setSettings({ fontSize: value })}
        disabled={disabled}
        label={null}
        aria-label={t('Font Size') ?? undefined}
      />
      <Text fz={18} c="chatbox-tertiary" aria-hidden>
        A
      </Text>
      <Text fz={13} fw={500} miw={88} ta="right">
        {draft === DEFAULT_FONT_SIZE ? `${draft}px · ${t('Default')}` : `${draft}px`}
      </Text>
    </Flex>
  )
}

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const density = useSettingsDensity()
  const segmentedSize = density === 'touch' ? 'sm' : 'xs'
  // A restore writes settings directly; changes made meanwhile would overwrite the restored ones.
  const backupActive = useBackupOperationActive()

  return (
    <SettingsPage
      title={t('Appearance')}
      description={t('Theme, text size, avatars and background. Changes apply immediately.')}
    >
      <fieldset disabled={backupActive} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        <SettingsSection>
          <SettingRow
            id="theme"
            label={t('Theme')}
            control={
              <SegmentedControl
                data-testid={TestId.settings.theme}
                size={segmentedSize}
                radius="md"
                value={`${settings.theme}`}
                onChange={(value) => setSettings({ theme: Number.parseInt(value, 10) })}
                data={[
                  { value: `${Theme.System}`, label: t('Follow System') },
                  { value: `${Theme.Light}`, label: t('Light') },
                  { value: `${Theme.Dark}`, label: t('Dark') },
                ]}
              />
            }
          />
          <SettingRow
            id="language"
            label={t('Language')}
            control={(fieldId) => (
              <AdaptiveSelect
                id={fieldId}
                comboboxProps={{ withinPortal: true }}
                w={180}
                size="xs"
                aria-label={t('Language') ?? undefined}
                value={settings.language}
                data={languages.map((language) => ({ value: language, label: languageNameMap[language] }))}
                onChange={(value) => {
                  if (value) setSettings({ language: value as Language })
                }}
              />
            )}
          />
          <SettingRow
            id="theme-color"
            label={t('Theme color')}
            description={t('Light and dark themes keep their own colors')}
            controlLayout="block"
            control={<InterfaceColorPresets />}
          />
          <SettingRow
            id="font-size"
            label={t('Font Size')}
            controlLayout="block"
            control={<FontSizeControl disabled={backupActive} />}
          />
          <SettingRow
            id="startup-page"
            label={t('Startup Page')}
            control={
              <SegmentedControl
                size={segmentedSize}
                radius="md"
                value={settings.startupPage ?? 'home'}
                onChange={(value) => {
                  if (value === 'home' || value === 'session') setSettings({ startupPage: value })
                }}
                data={[
                  { value: 'home', label: t('Home Page') },
                  { value: 'session', label: t('Last Session') },
                ]}
              />
            }
          />
          {canChangeAppIcon() && (
            <SettingRow
              id="app-icon"
              label={t('App icon')}
              control={
                <Button
                  component={Link}
                  to="/settings/app-icon"
                  variant="subtle"
                  color="chatbox-gray"
                  size="compact-sm"
                  rightSection={<ScalableIcon icon={IconChevronRight} size={16} />}
                >
                  {t('Change')}
                </Button>
              }
            />
          )}
        </SettingsSection>

        <SettingsSection title={t('Avatars & background')}>
          <SettingRow
            id="user-avatar"
            label={t('User Avatar')}
            control={
              <Flex align="center" gap="xs">
                <UserAvatar size={32} avatarKey={settings.userAvatarKey} />
                <ImageUploadButton
                  label={t('Change')}
                  onFile={(file) => {
                    const key = StorageKeyGenerator.picture('user-avatar')
                    handleImageInputAndSave(
                      file,
                      key,
                      () => setSettings({ userAvatarKey: key }),
                      (k, v) => currentBlobStorage.set(k, v)
                    )
                  }}
                />
                {!!settings.userAvatarKey && (
                  <Button
                    variant="subtle"
                    color="chatbox-gray"
                    size="xs"
                    onClick={() => setSettings({ userAvatarKey: undefined })}
                  >
                    {t('Delete')}
                  </Button>
                )}
              </Flex>
            }
          />
          <SettingRow
            id="assistant-avatar"
            label={t('Default Assistant Avatar')}
            control={
              <Flex align="center" gap="xs">
                <AssistantAvatar size={32} avatarKey={settings.defaultAssistantAvatarKey} />
                <ImageUploadButton
                  label={t('Change')}
                  onFile={(file) => {
                    const key = StorageKeyGenerator.picture('default-assistant-avatar')
                    handleImageInputAndSave(
                      file,
                      key,
                      () => setSettings({ defaultAssistantAvatarKey: key }),
                      (k, v) => currentBlobStorage.set(k, v)
                    )
                  }}
                />
                {!!settings.defaultAssistantAvatarKey && (
                  <Button
                    variant="subtle"
                    color="chatbox-gray"
                    size="xs"
                    onClick={() => setSettings({ defaultAssistantAvatarKey: undefined })}
                  >
                    {t('Delete')}
                  </Button>
                )}
              </Flex>
            }
          />
          <SettingRow
            id="background-image"
            label={t('Background Image')}
            description={t('jpg or png, up to 5MB. Each chat can set its own.')}
            control={
              <Flex align="center" gap="xs">
                {settings.backgroundImageKey && (
                  <Box w={48} h={32} className="overflow-hidden rounded bg-chatbox-background-secondary">
                    <ImageInStorage storageKey={settings.backgroundImageKey} className="object-cover w-full h-full" />
                  </Box>
                )}
                <ImageUploadButton
                  label={settings.backgroundImageKey ? t('Change') : t('Upload')}
                  onFile={(file) => {
                    const key = StorageKeyGenerator.picture('background-image')
                    handleImageInputAndSave(
                      file,
                      key,
                      () => setSettings({ backgroundImageKey: key }),
                      (k, v) => currentBlobStorage.set(k, v)
                    )
                  }}
                />
                {!!settings.backgroundImageKey && (
                  <Button
                    variant="subtle"
                    color="chatbox-gray"
                    size="xs"
                    onClick={() => setSettings({ backgroundImageKey: undefined })}
                  >
                    {t('Remove')}
                  </Button>
                )}
              </Flex>
            }
          />
          {!!settings.backgroundImageKey && (
            <SettingRow
              id="background-image-opacity"
              label={t('Background Image Opacity')}
              controlLayout="block"
              control={(fieldId) => (
                <SliderWithInput
                  inputId={fieldId}
                  value={Math.round(settings.backgroundImageOpacity * 100)}
                  onChange={(value) => setSettings({ backgroundImageOpacity: (value ?? 16) / 100 })}
                  max={100}
                  step={1}
                  suffix="%"
                />
              )}
            />
          )}
        </SettingsSection>
      </fieldset>
    </SettingsPage>
  )
}
