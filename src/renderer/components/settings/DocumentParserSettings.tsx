import type { DocumentParserType } from '@shared/types/settings'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { CheckedFieldRow } from '@/components/settings/CheckedFieldRow'
import { SettingRow, SettingsSection } from '@/components/settings/SettingsLayout'
import platform from '@/platform'
import { getPlatformDefaultDocumentParser, useSettingsStore } from '@/stores/settingsStore'

const ALL_PARSER_OPTIONS: {
  value: DocumentParserType
  label: string
  desktopOnly?: boolean
}[] = [
  { value: 'local', label: 'Local' },
  { value: 'chatbox-ai', label: 'Chatbox AI' },
  { value: 'mineru', label: 'MinerU', desktopOnly: true }, // Only available on desktop (requires IPC)
]

const PARSER_DESCRIPTIONS: Record<DocumentParserType, string> = {
  none: 'Only supports basic text files (.txt, .md, .json, code files, etc.). For PDF and Office files, please switch to Chatbox AI.',
  local:
    'Uses built-in document parsing feature, supports common file types. Free usage, no compute points will be consumed.',
  'chatbox-ai':
    'Tries local parsing first without consuming compute points. If local parsing fails, Chatbox AI cloud parsing will be used and compute points will be consumed.',
  mineru: 'Third-party cloud parsing service, supports PDF and most Office files. Requires API token.',
}

/** Parser choice and its credentials, as one settings section. */
export function DocumentParserSettings() {
  const { t } = useTranslation()

  const extension = useSettingsStore((state) => state.extension)
  const setSettings = useSettingsStore((state) => state.setSettings)

  const documentParser = extension?.documentParser
  const mineruToken = documentParser?.mineru?.apiToken || ''

  const parserOptions = useMemo(() => {
    const isDesktop = platform.type === 'desktop'
    return ALL_PARSER_OPTIONS.filter((opt) => {
      if (opt.desktopOnly && !isDesktop) return false
      if (opt.value === 'local' && !isDesktop && platform.type !== 'mobile') return false
      return true
    })
  }, [])

  const storedParserType = documentParser?.type || getPlatformDefaultDocumentParser().type
  const currentParserType = storedParserType === 'none' ? getPlatformDefaultDocumentParser().type : storedParserType

  return (
    <SettingsSection title={t('Parser')}>
      <SettingRow
        id="parser-type"
        label={t('Parser Type')}
        description={
          currentParserType === 'local' && platform.type === 'mobile'
            ? t(
                'Parses text, DOCX, XLSX, and PPTX files locally first (Office files up to 10 MB). If local parsing fails, Chatbox AI cloud parsing will be used when a license is available and compute points will be consumed.'
              )
            : t(PARSER_DESCRIPTIONS[currentParserType])
        }
        controlLayout="block"
        control={(fieldId) => (
          <AdaptiveSelect
            id={fieldId}
            comboboxProps={{ withinPortal: true, withArrow: true }}
            aria-label={t('Parser Type') ?? undefined}
            data={parserOptions.map((opt) => ({
              value: opt.value,
              label: t(opt.label),
            }))}
            value={currentParserType}
            onChange={(value) => {
              if (!value) return
              setSettings({
                extension: { ...extension, documentParser: { ...documentParser, type: value as DocumentParserType } },
              })
            }}
          />
        )}
      />
      {currentParserType === 'mineru' && (
        <CheckedFieldRow
          id="mineru-api-token"
          label={t('MinerU API Token')}
          secret
          value={mineruToken}
          onChange={(apiToken) =>
            setSettings({
              extension: {
                ...extension,
                documentParser: { ...documentParser, type: documentParser?.type || 'mineru', mineru: { apiToken } },
              },
            })
          }
          check={async (token) => {
            const result = await platform.getKnowledgeBaseController().testMineruConnection(token)
            if (!result.success) throw new Error('MinerU rejected the token')
          }}
          failureMessage={t('API key invalid!')}
          getKeyUrl="https://mineru.net/apiManage"
          getKeyLabel={t('Get API Token') ?? undefined}
        />
      )}
    </SettingsSection>
  )
}

export default DocumentParserSettings
