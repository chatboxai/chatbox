import { Button, Flex, PasswordInput, Stack, Text, Title } from '@mantine/core'
import type { DocumentParserType } from '@shared/types/settings'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import platform from '@/platform'
import { getPlatformDefaultDocumentParser, useSettingsStore } from '@/stores/settingsStore'

const ALL_PARSER_OPTIONS: {
  value: DocumentParserType
  label: string
  desktopOnly?: boolean
  mobileWebOnly?: boolean
}[] = [
  { value: 'none', label: 'Text Only', mobileWebOnly: true }, // Basic text file support only (mobile/web only)
  { value: 'local', label: 'Local', desktopOnly: true }, // Only available on desktop
  { value: 'mineru', label: 'MinerU', desktopOnly: true }, // Only available on desktop (requires IPC)
]

const PARSER_DESCRIPTIONS: Record<DocumentParserType, string> = {
  none: 'Only supports basic text files (.txt, .md, .json, code files, etc.).',
  local:
    'Uses built-in document parsing feature, supports common file types. Free usage, no compute points will be consumed.',
  'chatbox-ai': 'Legacy parser setting from older versions. It is mapped to Local in this build.',
  mineru: 'Third-party cloud parsing service, supports PDF and most Office files. Requires API token.',
}

interface DocumentParserSettingsProps {
  showTitle?: boolean
}

export function DocumentParserSettings({ showTitle = true }: DocumentParserSettingsProps) {
  const { t } = useTranslation()

  const extension = useSettingsStore((state) => state.extension)
  const setSettings = useSettingsStore((state) => state.setSettings)

  const documentParser = extension?.documentParser
  const mineruToken = documentParser?.mineru?.apiToken || ''

  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionResult, setConnectionResult] = useState<boolean | undefined>()

  const parserOptions = useMemo(() => {
    const isDesktop = platform.type === 'desktop'
    return ALL_PARSER_OPTIONS.filter((opt) => {
      if (opt.desktopOnly && !isDesktop) return false
      if (opt.mobileWebOnly && isDesktop) return false
      return true
    })
  }, [])

  const platformDefaultParserType = getPlatformDefaultDocumentParser().type
  const currentParserType =
    documentParser?.type === 'chatbox-ai'
      ? platformDefaultParserType
      : documentParser?.type || platformDefaultParserType

  const handleParserTypeChange = useCallback(
    (value: string | null) => {
      if (!value) return
      setSettings({
        extension: {
          ...extension,
          documentParser: {
            ...documentParser,
            type: value as DocumentParserType,
          },
        },
      })
      setConnectionResult(undefined)
    },
    [setSettings, extension, documentParser]
  )

  const handleMineruTokenChange = useCallback(
    (value: string) => {
      setConnectionResult(undefined)
      setSettings({
        extension: {
          ...extension,
          documentParser: {
            ...documentParser,
            type: documentParser?.type || 'mineru',
            mineru: { apiToken: value },
          },
        },
      })
    },
    [setSettings, extension, documentParser]
  )

  const handleTestConnection = useCallback(async () => {
    if (!mineruToken.trim()) return

    setTestingConnection(true)
    setConnectionResult(undefined)

    try {
      const result = await platform.getKnowledgeBaseController().testMineruConnection(mineruToken)
      setConnectionResult(result.success)
    } catch {
      setConnectionResult(false)
    } finally {
      setTestingConnection(false)
    }
  }, [mineruToken])

  return (
    <Stack p="md" gap="xxl">
      {showTitle && <Title order={5}>{t('Document Parser')}</Title>}

      <AdaptiveSelect
        comboboxProps={{ withinPortal: true, withArrow: true }}
        data={parserOptions.map((opt) => ({
          value: opt.value,
          label: t(opt.label),
        }))}
        value={currentParserType}
        onChange={handleParserTypeChange}
        label={t('Parser Type')}
        maw={320}
      />

      <Text size="xs" c="chatbox-gray">
        {t(PARSER_DESCRIPTIONS[currentParserType])}
      </Text>

      {currentParserType === 'mineru' && (
        <Stack gap="xs">
          <Text fw="600">{t('MinerU API Token')}</Text>
          <Flex align="center" gap="xs">
            <PasswordInput
              flex={1}
              maw={320}
              value={mineruToken}
              onChange={(e) => handleMineruTokenChange(e.currentTarget.value)}
              error={connectionResult === false}
            />
            <Button
              color="blue"
              variant="light"
              onClick={handleTestConnection}
              loading={testingConnection}
              disabled={!mineruToken.trim()}
            >
              {t('Check')}
            </Button>
          </Flex>

          {typeof connectionResult === 'boolean' ? (
            connectionResult ? (
              <Text size="xs" c="chatbox-success">
                {t('Connection successful!')}
              </Text>
            ) : (
              <Text size="xs" c="chatbox-error">
                {t('API key invalid!')}
              </Text>
            )
          ) : null}
          <Button
            variant="transparent"
            size="compact-xs"
            px={0}
            className="self-start"
            onClick={() => platform.openLink('https://mineru.net/apiManage')}
          >
            {t('Get API Token')}
          </Button>
        </Stack>
      )}
    </Stack>
  )
}

export default DocumentParserSettings
