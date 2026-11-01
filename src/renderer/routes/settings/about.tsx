import { Button, Flex, Image } from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingRow, SettingSwitchRow, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
import useVersion from '@/hooks/useVersion'
import platform from '@/platform'
import { router } from '@/router'
import { UpdateSection } from '@/routes/about'
import iconPNG from '@/static/icon.png'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/about')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const version = useVersion()
  const language = useLanguage()
  const autoLaunch = useSettingsStore((s) => s.autoLaunch)
  const autoUpdate = useSettingsStore((s) => s.autoUpdate)
  const betaUpdate = useSettingsStore((s) => s.betaUpdate)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const hasVersion = /\d/.test(version.version)

  return (
    <SettingsPage title={t('About & Updates')} description={t('Version, updates and startup behavior.')}>
      <SettingsSection>
        <SettingRow
          id="version"
          label={
            <Flex align="center" gap="sm">
              <Image src={iconPNG} w={32} h={32} radius="md" />
              <span>Chatbox{hasVersion ? ` ${version.version}` : ''}</span>
            </Flex>
          }
          control={<UpdateSection language={language} needCheckUpdate={version.needCheckUpdate} />}
        />
        <SettingRow
          id="about-chatbox"
          label={t('About Chatbox')}
          control={
            <Button
              // The app router, not the settings one: settings can be open as an overlay whose
              // own router has no About page.
              onClick={() => void router.navigate({ to: '/about' })}
              variant="subtle"
              color="chatbox-gray"
              size="compact-sm"
              rightSection={<ScalableIcon icon={IconChevronRight} size={16} />}
            >
              {t('View')}
            </Button>
          }
        />
      </SettingsSection>
      {platform.type === 'desktop' && (
        <SettingsSection title={t('Startup & updates')}>
          <SettingSwitchRow
            id="auto-launch"
            label={t('Launch at system startup')}
            checked={autoLaunch}
            onChange={(checked) => setSettings({ autoLaunch: checked })}
          />
          <SettingSwitchRow
            id="auto-update"
            label={t('Automatic updates')}
            checked={autoUpdate}
            onChange={(checked) => setSettings({ autoUpdate: checked })}
          />
          <SettingSwitchRow
            id="beta-update"
            label={t('Beta updates')}
            description={t('Get new features earlier; beta builds may be less stable.')}
            checked={betaUpdate}
            onChange={(checked) => setSettings({ betaUpdate: checked })}
          />
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
