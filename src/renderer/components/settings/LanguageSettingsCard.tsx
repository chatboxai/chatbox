import { Text } from '@mantine/core'
import { IconCheck, IconChevronRight, IconLanguage } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ICON_STROKE_WIDTH } from '@/components/common/IconButton'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { languageNameMap, languages } from '@/i18n/locales'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Top-level language switcher for the mobile settings home. The same control also lives in
 * Settings → Appearance, but that is one navigation level deeper than most people look.
 */
export function LanguageSettingsCard() {
  const { t } = useTranslation()
  const language = useSettingsStore((state) => state.language)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [opened, setOpened] = useState(false)

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl bg-chatbox-background-raised">
        <button
          type="button"
          data-testid="settings-language-entry"
          className="flex min-h-11 items-center gap-3 px-3.5 text-left text-chatbox-tint-primary active:bg-chatbox-background-gray-secondary"
          onClick={() => setOpened(true)}
        >
          <ScalableIcon
            icon={IconLanguage}
            size={20}
            strokeWidth={ICON_STROKE_WIDTH}
            className="shrink-0 text-chatbox-tint-secondary"
          />
          <Text fz={15} flex={1} lineClamp={1}>
            {t('Language')}
          </Text>
          <Text fz={14} c="chatbox-tertiary" maw="45%" truncate>
            {languageNameMap[language]}
          </Text>
          <ScalableIcon icon={IconChevronRight} size={20} className="shrink-0 text-chatbox-tint-tertiary" />
        </button>
      </div>
      <AdaptiveModal opened={opened} onClose={() => setOpened(false)} title={t('Select Language')}>
        <div className="flex flex-col overflow-hidden rounded-xl bg-chatbox-background-raised">
          {languages.map((lang) => {
            const current = lang === language
            return (
              <button
                key={lang}
                type="button"
                data-testid={`settings-language-${lang}`}
                aria-pressed={current}
                className="flex min-h-11 items-center gap-3 border-0 border-t border-solid border-chatbox-border-primary px-3.5 text-left first:border-t-0 active:bg-chatbox-background-gray-secondary"
                onClick={() => {
                  setSettings({ language: lang })
                  setOpened(false)
                }}
              >
                <Text fz={15} flex={1} lineClamp={1} c={current ? 'chatbox-tint-brand' : 'chatbox-tint-primary'}>
                  {languageNameMap[lang]}
                </Text>
                {current && <IconCheck size={18} className="shrink-0 text-chatbox-tint-brand" />}
              </button>
            )
          })}
        </div>
      </AdaptiveModal>
    </>
  )
}
