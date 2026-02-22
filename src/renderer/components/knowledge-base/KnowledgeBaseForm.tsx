import { Button, Group, Input, PasswordInput, Select, Stack, Text } from '@mantine/core'
import type { DocumentParserConfig, DocumentParserType } from '@shared/types/settings'
import { IconCheck, IconTrash, IconX } from '@tabler/icons-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import platform from '@/platform'
import { ScalableIcon } from '../common/ScalableIcon'

interface ModelSelectorsProps {
  embeddingModelList: Array<{ label: string; value: string }>
  rerankModelList: Array<{ label: string; value: string }>
  visionModelList: Array<{ label: string; value: string }>
  embeddingModel?: string | null
  rerankModel?: string | null
  visionModel?: string | null
  onEmbeddingModelChange?: (value: string | null) => void
  onRerankModelChange?: (value: string | null) => void
  onVisionModelChange?: (value: string | null) => void
  isEmbeddingDisabled?: boolean
  showEmbeddingModel?: boolean
}

export const KnowledgeBaseModelSelectors: React.FC<ModelSelectorsProps> = ({
  embeddingModelList,
  rerankModelList,
  visionModelList,
  embeddingModel,
  rerankModel,
  visionModel,
  onEmbeddingModelChange,
  onRerankModelChange,
  onVisionModelChange,
  isEmbeddingDisabled = false,
  showEmbeddingModel = true,
}) => {
  const { t } = useTranslation()

  return (
    <>
      {showEmbeddingModel && (
        <Select
          label={t('Embedding Model')}
          description={t('Used to extract text feature vectors, add in Settings - Provider - Model List')}
          data={embeddingModelList}
          value={embeddingModel}
          onChange={onEmbeddingModelChange}
          required={!isEmbeddingDisabled}
          disabled={isEmbeddingDisabled}
          searchable
          comboboxProps={{ withinPortal: false }}
          allowDeselect={false}
        />
      )}
      <Select
        label={t('Rerank Model (optional)')}
        description={t('Used to get more accurate search results')}
        data={rerankModelList}
        value={rerankModel}
        onChange={onRerankModelChange}
        clearable
        searchable
        comboboxProps={{ withinPortal: false, position: 'bottom' }}
      />
      <Select
        label={t('Vision Model (optional)')}
        description={t('Used to preprocess image files, requires models with vision capabilities enabled')}
        data={visionModelList}
        value={visionModel}
        onChange={onVisionModelChange}
        clearable
        searchable
        comboboxProps={{ withinPortal: false, position: 'bottom' }}
      />
    </>
  )
}

interface KnowledgeBaseFormActionsProps {
  onCancel: () => void
  onConfirm: () => void
  confirmText: string
  isConfirmDisabled?: boolean
  showDelete?: boolean
  onDelete?: () => void
}

export const KnowledgeBaseFormActions: React.FC<KnowledgeBaseFormActionsProps> = ({
  onCancel,
  onConfirm,
  confirmText,
  isConfirmDisabled = false,
  showDelete = false,
  onDelete,
}) => {
  const { t } = useTranslation()

  if (showDelete && onDelete) {
    return (
      <Group justify="space-between">
        <Button variant="outline" color="red" leftSection={<IconTrash size={16} />} onClick={onDelete}>
          {t('Delete')}
        </Button>
        <Group>
          <Button variant="default" onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={isConfirmDisabled}>
            {confirmText}
          </Button>
        </Group>
      </Group>
    )
  }

  return (
    <Group justify="flex-end">
      <Button variant="default" onClick={onCancel}>
        {t('Cancel')}
      </Button>
      <Button onClick={onConfirm} disabled={isConfirmDisabled}>
        {confirmText}
      </Button>
    </Group>
  )
}

interface KnowledgeBaseNameInputProps {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  autoFocus?: boolean
}

export const KnowledgeBaseNameInput: React.FC<KnowledgeBaseNameInputProps> = ({
  value,
  onChange,
  label,
  placeholder,
  autoFocus = false,
}) => {
  const { t } = useTranslation()

  return (
    <Input.Wrapper label={label}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || t('New knowledge base name')}
        autoFocus={autoFocus}
      />
    </Input.Wrapper>
  )
}

const PARSER_OPTIONS: { value: DocumentParserType; label: string; description: string }[] = [
  {
    value: 'local',
    label: 'Local',
    description:
      'Uses built-in document parsing feature, supports common file types. Free usage, no compute points will be consumed.',
  },
  {
    value: 'mineru',
    label: 'MinerU',
    description: 'Third-party cloud parsing service, supports PDF and most Office files. Requires API token.',
  },
]

function normalizeDocumentParserType(type: DocumentParserType): DocumentParserType {
  return PARSER_OPTIONS.some((option) => option.value === type) ? type : 'local'
}

interface DocumentParserSelectorProps {
  parserConfig: DocumentParserConfig
  onParserConfigChange: (config: DocumentParserConfig) => void
  disabled?: boolean
}

export const DocumentParserSelector: React.FC<DocumentParserSelectorProps> = ({
  parserConfig,
  onParserConfigChange,
  disabled = false,
}) => {
  const { t } = useTranslation()
  const [mineruToken, setMineruToken] = useState(parserConfig.mineru?.apiToken || '')
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; error?: string } | null>(null)
  const effectiveParserType = normalizeDocumentParserType(parserConfig.type)

  const handleParserTypeChange = useCallback(
    (value: string | null) => {
      if (!value) return
      const newType = value as DocumentParserType

      const newConfig: DocumentParserConfig = { type: newType }

      // Preserve MinerU token if switching to MinerU
      if (newType === 'mineru' && mineruToken) {
        newConfig.mineru = { apiToken: mineruToken }
      }

      onParserConfigChange(newConfig)
      setConnectionResult(null)
    },
    [onParserConfigChange, mineruToken]
  )

  const handleMineruTokenChange = useCallback(
    (value: string) => {
      setMineruToken(value)
      setConnectionResult(null)
      onParserConfigChange({
        type: 'mineru',
        mineru: { apiToken: value },
      })
    },
    [onParserConfigChange]
  )

  const handleTestConnection = useCallback(async () => {
    if (!mineruToken.trim()) {
      toast.error(t('Please enter an API token'))
      return
    }

    setTestingConnection(true)
    setConnectionResult(null)

    try {
      const result = await platform.getKnowledgeBaseController().testMineruConnection(mineruToken)
      setConnectionResult(result)

      if (result.success) {
        toast.success(t('Connection successful'))
      } else {
        toast.error(result.error || t('Connection failed'))
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      setConnectionResult({ success: false, error: errorMessage })
      toast.error(errorMessage)
    } finally {
      setTestingConnection(false)
    }
  }, [mineruToken, t])

  const selectedOption = PARSER_OPTIONS.find((opt) => opt.value === effectiveParserType)

  return (
    <Stack gap="xs">
      <Select
        label={t('Document Parser')}
        description={t('Parser used to process uploaded documents')}
        data={PARSER_OPTIONS.map((opt) => ({
          value: opt.value,
          label: t(opt.label),
        }))}
        value={effectiveParserType}
        onChange={handleParserTypeChange}
        allowDeselect={false}
        disabled={disabled}
        comboboxProps={{ withinPortal: false }}
      />
      {selectedOption && !disabled && (
        <Text size="xs" c="dimmed">
          {t(selectedOption.description)}
        </Text>
      )}

      {parserConfig.type === 'mineru' && !disabled && (
        <Stack gap="xs">
          <PasswordInput
            placeholder={t('Enter your MinerU API token') as string}
            value={mineruToken}
            onChange={(e) => handleMineruTokenChange(e.target.value)}
          />
          <Group gap="xs" align="center">
            <Button
              variant="outline"
              size="xs"
              onClick={handleTestConnection}
              loading={testingConnection}
              disabled={!mineruToken.trim()}
            >
              {t('Test Connection')}
            </Button>
            {connectionResult && (
              <Group gap={4}>
                {connectionResult.success ? (
                  <>
                    <ScalableIcon icon={IconCheck} size={16} color="green" />
                    <Text size="xs" c="green">
                      {t('Connected')}
                    </Text>
                  </>
                ) : (
                  <>
                    <ScalableIcon icon={IconX} size={16} color="red" />
                    <Text size="xs" c="red">
                      {connectionResult.error || t('Failed')}
                    </Text>
                  </>
                )}
              </Group>
            )}
          </Group>
        </Stack>
      )}
    </Stack>
  )
}

interface DocumentParserDisplayProps {
  parserType?: DocumentParserType
}

export const DocumentParserDisplay: React.FC<DocumentParserDisplayProps> = ({ parserType }) => {
  const { t } = useTranslation()
  const currentType = parserType || 'local'

  return (
    <Select
      label={t('Document Parser')}
      description={t('Parser used to process uploaded documents')}
      data={PARSER_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.label),
      }))}
      value={currentType}
      disabled
      comboboxProps={{ withinPortal: false }}
    />
  )
}
