import { Button, Flex, Stack, Text } from '@mantine/core'
import { IconUpload } from '@tabler/icons-react'
import type { ProviderModelInfo } from '@shared/types'
import { IconRefresh, IconRestore } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { ModelList } from '@/components/ModelList'
import { BatchImportModelsModal } from '@/components/BatchImportModelsModal'

interface ModelManagementProps {
  chatboxAIModels: ProviderModelInfo[]
  allChatboxAIModels: ProviderModelInfo[]
  onDeleteModel: (modelId: string) => void
  onResetModels: () => void
  onFetchModels: () => void
  onAddModel: (model: ProviderModelInfo) => void
  onRemoveModel: (modelId: string) => void
}

export function ModelManagement({
  chatboxAIModels,
  allChatboxAIModels,
  onDeleteModel,
  onResetModels,
  onFetchModels,
  onAddModel,
  onRemoveModel,
}: ModelManagementProps) {
  const { t } = useTranslation()
  const [showFetchedModels, setShowFetchedModels] = useState(false)
  const [showBatchImport, setShowBatchImport] = useState(false)

  const handleBatchImport = (models: ProviderModelInfo[]) => {
    for (const model of models) {
      onAddModel(model)
    }
  }

  const existingModelIds = chatboxAIModels.map((m) => m.modelId)

  const handleFetchModels = () => {
    onFetchModels()
    setShowFetchedModels(true)
  }

  return (
    <>
      <Stack gap="xxs">
        <Flex justify="space-between" align="center">
          <Text span fw="600">
            {t('Model')}
          </Text>
          <Flex gap="sm" align="center" justify="flex-end">
            <Button
              variant="light"
              color="chatbox-gray"
              c="chatbox-secondary"
              size="compact-xs"
              px="sm"
              onClick={() => setShowBatchImport(true)}
              leftSection={<ScalableIcon icon={IconUpload} size={12} />}
            >
              {t('Batch Import')}
            </Button>

            <Button
              variant="light"
              color="chatbox-gray"
              c="chatbox-secondary"
              size="compact-xs"
              px="sm"
              onClick={onResetModels}
              leftSection={<ScalableIcon icon={IconRestore} size={12} />}
            >
              {t('Reset')}
            </Button>

            <Button
              variant="light"
              color="chatbox-gray"
              c="chatbox-secondary"
              size="compact-xs"
              px="sm"
              onClick={handleFetchModels}
              leftSection={<ScalableIcon icon={IconRefresh} size={12} />}
            >
              {t('Fetch')}
            </Button>
          </Flex>
        </Flex>

        <ModelList models={chatboxAIModels} showActions={true} onDeleteModel={onDeleteModel} showSearch={false} />
      </Stack>

      <AdaptiveModal
        keepMounted={false}
        opened={showFetchedModels}
        onClose={() => setShowFetchedModels(false)}
        title={t('Models')}
        centered={true}
        size="lg"
      >
        <ModelList
          models={allChatboxAIModels}
          showActions={true}
          onAddModel={onAddModel}
          onRemoveModel={onRemoveModel}
          displayedModelIds={chatboxAIModels.map((m) => m.modelId)}
          showSearch={true}
        />
      </AdaptiveModal>

      <BatchImportModelsModal
        opened={showBatchImport}
        onClose={() => setShowBatchImport(false)}
        onImport={handleBatchImport}
        existingModelIds={existingModelIds}
      />
    </>
  )
}
