import { Alert, Button, Flex, Group, Paper, Pill, Stack, Text, Title } from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle, IconPlus } from '@tabler/icons-react'
import compact from 'lodash/compact'
import flatten from 'lodash/flatten'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SystemProviders } from 'src/shared/defaults'
import type { KnowledgeBase, ModelProvider, ProviderModelInfo } from 'src/shared/types'
import { parseKnowledgeBaseModelString } from 'src/shared/utils/knowledge-base-model-parser'
import { useProviders } from '@/hooks/useProviders'
import * as remote from '@/packages/remote'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { trackEvent } from '@/utils/track'
import { Modal } from '../Overlay'
import { ScalableIcon } from '../ScalableIcon'
import KnowledgeBaseDocuments from './KnowledgeBaseDocuments'
import {
  KnowledgeBaseChatboxAIInfo,
  KnowledgeBaseFormActions,
  KnowledgeBaseModelSelectors,
  KnowledgeBaseNameInput,
  KnowledgeBaseProviderModeSelect,
} from './KnowledgeBaseForm'

interface ModelPillProps {
  modelValue: string | null | undefined
  formatModelName: (model: string) => string
  isProviderAvailable: (model: string) => boolean
  type: 'embedding' | 'rerank' | 'vision'
  t: (key: string) => string
}

const ModelPill: React.FC<ModelPillProps> = ({ modelValue, formatModelName, isProviderAvailable, type, t }) => {
  const isEmbedding = type === 'embedding'
  const hasModel = !!modelValue
  const modelUnavailable = useMemo(
    () => !hasModel || !isProviderAvailable(modelValue),
    [hasModel, isProviderAvailable, modelValue]
  )
  const getColor = () => {
    if (!hasModel) return 'dimmed'
    if (modelUnavailable) return 'red'
    return ''
  }

  const getIcon = () => {
    if (!hasModel || isProviderAvailable(modelValue)) return null
    return <ScalableIcon icon={IconAlertTriangle} size={12} color="red" title={t('Provider unavailable')} />
  }

  const maxWidth = isEmbedding ? 200 : 150

  const modelText = useMemo(
    () => (hasModel ? formatModelName(modelValue) : t('None')),
    [hasModel, modelValue, formatModelName, t]
  )

  return (
    <Pill style={{ display: 'flex', alignItems: 'center' }}>
      <Flex align="center" gap="xs" maw={maxWidth} h={'100%'}>
        <Text
          c={getColor()}
          size="xs"
          title={modelText}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {modelText}
        </Text>
        {getIcon()}
      </Flex>
    </Pill>
  )
}

const KnowledgeBasePage: React.FC = () => {
  const { t } = useTranslation()
  const [kbList, setKbList] = useState<KnowledgeBase[]>([])
  const [newKbName, setNewKbName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const customProviders = useSettingsStore((state) => state.customProviders)

  const [newEmbeddingModel, setNewEmbeddingModel] = useState<string | null>(null)
  const [newRerankModel, setNewRerankModel] = useState<string | null>(null)
  const [newVisionModel, setNewVisionModel] = useState<string | null>(null)
  const [editKb, setEditKb] = useState<(Partial<KnowledgeBase> & { id: number }) | null>(null)
  const [editRerankModel, setEditRerankModel] = useState<string | null>(null)
  const [editVisionModel, setEditVisionModel] = useState<string | null>(null)
  const [deleteConfirmKb, setDeleteConfirmKb] = useState<(Partial<KnowledgeBase> & { id: number }) | null>(null)
  const [isUnsupportedPlatform, setIsUnsupportedPlatform] = useState(false)

  const [chatboxAIModels, setChatboxAIModels] = useState<{
    embedding: string
    vision: string
    rerank: string
  } | null>(null)

  const canUseChatboxAIProvider = useMemo(() => {
    return !!(chatboxAIModels && licenseKey)
  }, [chatboxAIModels, licenseKey])

  const [newProviderMode, setNewProviderMode] = useState<'chatbox-ai' | 'custom'>('custom')

  useEffect(() => {
    if (canUseChatboxAIProvider) {
      setNewProviderMode('chatbox-ai')
    } else {
      setNewProviderMode('custom')
    }
  }, [canUseChatboxAIProvider])

  const { providers } = useProviders()

  const getModelList = useCallback(
    (filter: (model: ProviderModelInfo) => boolean) => {
      return compact(
        flatten(
          providers.map((provider) => {
            return provider.models?.filter(filter).map((model) => {
              return {
                label: `${provider.name} | ${model.nickname || model.modelId}`,
                value: `${provider.id}:${model.modelId}`,
              }
            })
          })
        )
      )
    },
    [providers]
  )

  const embeddingModelList = useMemo(() => {
    return getModelList((model) => !!model.type && model.type === 'embedding')
  }, [getModelList])

  const rerankModelList = useMemo(() => {
    return getModelList((model) => model.type === 'rerank')
  }, [getModelList])

  const visionModelList = useMemo(() => {
    return getModelList((model) => !!model.capabilities?.includes('vision'))
  }, [getModelList])

  const knowledgeBaseController = useMemo(() => {
    return platform.getKnowledgeBaseController()
  }, [])

  const getProviderName = useCallback(
    (providerId: string) => {
      if (SystemProviders.map((it) => it.id).includes(providerId as ModelProvider)) {
        return SystemProviders.find((it) => it.id === providerId)?.name
      }

      const customProvider = customProviders?.find((it) => it.id === providerId)
      if (customProvider) {
        return customProvider.name
      }

      return providerId
    },
    [customProviders]
  )

  const getModelName = useCallback(
    (providerId: string, modelId: string) => {
      const provider = providers.find((it) => it.id === providerId)
      if (provider) {
        const model = provider.models?.find((it) => it.modelId === modelId)
        if (model) {
          return model.nickname || model.modelId
        }
      }
    },
    [providers]
  )

  const isProviderAvailable = useCallback(
    (modelString: string) => {
      const parsed = parseKnowledgeBaseModelString(modelString)
      if (!parsed) return false
      return providers.some((provider) => provider.id === parsed.providerId)
    },
    [providers]
  )

  function formatModelName(model: string) {
    const parsed = parseKnowledgeBaseModelString(model)
    if (!parsed) return t('Unknown')
    const { providerId, modelId } = parsed
    const providerName = getProviderName(providerId)
    const modelName = getModelName(providerId, modelId) || modelId
    return `${providerName} | ${modelName}`
  }

  const fetchKbList = useCallback(async () => {
    if (isUnsupportedPlatform) return
    try {
      const list = await knowledgeBaseController.list()
      if (list) {
        setKbList(list)
      }
    } catch (error) {
      toast.error(t('Failed to fetch knowledge base list, Error: {{error}}', { error: error }))
    }
  }, [knowledgeBaseController, isUnsupportedPlatform, t])

  useEffect(() => {
    fetchKbList()
  }, [fetchKbList])

  // Check platform compatibility
  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const platformName = await platform.getPlatform()
        const arch = await platform.getArch()
        const isWin32Arm64 = platformName === 'win32' && arch === 'arm64'
        setIsUnsupportedPlatform(isWin32Arm64)
      } catch (error) {
        console.error('Failed to check platform compatibility:', error)
      }
    }
    checkPlatform()
  }, [])

  // Fetch Chatbox AI models configuration
  useEffect(() => {
    const fetchChatboxAIModels = async () => {
      try {
        const config = await remote.getRemoteConfig('knowledge_base_models')
        if (config.knowledge_base_models) {
          setChatboxAIModels(config.knowledge_base_models)
        }
      } catch (error) {
        toast.error(t('Failed to fetch Chatbox AI models config, Error: {{error}}', { error: error }))
      }
    }
    fetchChatboxAIModels()
  }, [t])

  const createKb = async () => {
    if (!newKbName) return

    let embeddingModel: string
    let rerankModel: string
    let visionModel: string

    if (newProviderMode === 'chatbox-ai') {
      if (!chatboxAIModels) return
      embeddingModel = chatboxAIModels.embedding
      rerankModel = chatboxAIModels.rerank
      visionModel = chatboxAIModels.vision
    } else {
      if (!newEmbeddingModel) return
      embeddingModel = newEmbeddingModel
      rerankModel = newRerankModel || ''
      visionModel = newVisionModel || ''
    }

    try {
      await knowledgeBaseController.create({
        name: newKbName,
        embeddingModel: embeddingModel,
        rerankModel: rerankModel,
        visionModel: visionModel,
      })

      trackEvent('knowledge_base_created', {
        provider_mode: newProviderMode,
        embedding_model: embeddingModel,
        rerank_model: rerankModel || null,
        vision_model: visionModel || null,
        knowledge_base_name: newKbName,
      })

      // Reset form
      setNewKbName('')
      setNewProviderMode('chatbox-ai')
      setNewEmbeddingModel(null)
      setNewRerankModel(null)
      setNewVisionModel(null)
      setShowCreate(false)
      fetchKbList()
    } catch (e) {
      toast.error(t('Failed to create knowledge base, Error: {{error}}', { error: e }))
    }
  }

  const handleEditKb = (kb: KnowledgeBase) => {
    setEditKb(kb)
    setEditRerankModel(kb.rerankModel ? `${kb.rerankModel}` : null)
    setEditVisionModel(kb.visionModel ? `${kb.visionModel}` : null)
  }

  const handleSaveEditKb = async () => {
    if (!editKb) return

    try {
      await knowledgeBaseController.update({
        id: editKb.id,
        name: editKb.name,
        rerankModel: editRerankModel || '',
        visionModel: editVisionModel || '',
      })
      setEditKb(null)
      setEditRerankModel(null)
      setEditVisionModel(null)
      fetchKbList()
    } catch (e) {
      toast.error(t('Failed to update knowledge base, Error: {{error}}', { error: e }))
    }
  }

  const handleDeleteKb = async () => {
    if (!deleteConfirmKb) return
    try {
      await knowledgeBaseController.delete(deleteConfirmKb.id)
      setDeleteConfirmKb(null)
      setEditKb(null) // Close edit modal if it's open
      fetchKbList()
    } catch (error) {
      console.error('Failed to delete knowledge base:', error)
    }
  }

  return (
    <Stack p="md" gap="xl">
      <Group justify="space-between" align="center">
        <Title order={5}>{t('Knowledge Base')}</Title>
        <Button variant="outline" onClick={() => setShowCreate(true)} disabled={isUnsupportedPlatform}>
          <Group gap="xs">
            <ScalableIcon icon={IconPlus} size={16} />
            <Text size="sm" c="chatbox-brand" fw={400}>
              {t('Add')}
            </Text>
          </Group>
        </Button>
      </Group>

      {isUnsupportedPlatform && (
        <Alert
          variant="light"
          color="orange"
          title={t('Platform Not Supported')}
          icon={<ScalableIcon icon={IconInfoCircle} size={16} />}
        >
          <Text size="sm">
            {t(
              'Knowledge Base functionality is not available on Windows ARM64 due to library compatibility issues. This feature is supported on Windows x64, macOS, and Linux.'
            )}
          </Text>
        </Alert>
      )}

      <Modal opened={showCreate} onClose={() => setShowCreate(false)} title={t('Create Knowledge Base')} centered>
        <Stack gap="md">
          <KnowledgeBaseNameInput value={newKbName} onChange={setNewKbName} autoFocus />

          <KnowledgeBaseProviderModeSelect
            value={newProviderMode}
            onChange={setNewProviderMode}
            isChatboxAIDisabled={!canUseChatboxAIProvider}
          />

          {newProviderMode === 'chatbox-ai' ? (
            <KnowledgeBaseChatboxAIInfo hasError={!chatboxAIModels} />
          ) : (
            <KnowledgeBaseModelSelectors
              embeddingModelList={embeddingModelList}
              rerankModelList={rerankModelList}
              visionModelList={visionModelList}
              embeddingModel={newEmbeddingModel}
              rerankModel={newRerankModel}
              visionModel={newVisionModel}
              onEmbeddingModelChange={setNewEmbeddingModel}
              onRerankModelChange={setNewRerankModel}
              onVisionModelChange={setNewVisionModel}
            />
          )}

          <KnowledgeBaseFormActions
            onCancel={() => setShowCreate(false)}
            onConfirm={createKb}
            confirmText={t('Create')}
            isConfirmDisabled={
              !newKbName || (newProviderMode === 'chatbox-ai' ? !canUseChatboxAIProvider : !newEmbeddingModel)
            }
          />
        </Stack>
      </Modal>
      <Modal opened={!!editKb} onClose={() => setEditKb(null)} title={t('Edit Knowledge Base')} centered>
        <Stack gap="md">
          <KnowledgeBaseNameInput
            value={editKb?.name || ''}
            onChange={(value) => editKb && setEditKb({ ...editKb, name: value })}
            label={t('Name') as string}
          />
          {editKb?.embeddingModel?.startsWith('chatbox-ai') ? (
            <KnowledgeBaseChatboxAIInfo showModelsLabel />
          ) : (
            <KnowledgeBaseModelSelectors
              embeddingModelList={embeddingModelList}
              rerankModelList={rerankModelList}
              visionModelList={visionModelList}
              embeddingModel={editKb ? `${editKb.embeddingModel}` : ''}
              rerankModel={editRerankModel}
              visionModel={editVisionModel}
              onRerankModelChange={setEditRerankModel}
              onVisionModelChange={setEditVisionModel}
              isEmbeddingDisabled
            />
          )}
          <KnowledgeBaseFormActions
            onCancel={() => setEditKb(null)}
            onConfirm={handleSaveEditKb}
            confirmText={t('Save')}
            showDelete
            onDelete={() => setDeleteConfirmKb(editKb)}
          />
        </Stack>
      </Modal>
      {/* Delete Confirmation Modal */}
      <Modal
        opened={!!deleteConfirmKb}
        onClose={() => setDeleteConfirmKb(null)}
        title={t('Delete Knowledge Base')}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            {t('Are you sure you want to delete the knowledge base')} "{deleteConfirmKb?.name}"?
          </Text>
          <Text size="sm" c="dimmed">
            {t('This action cannot be undone. All documents and their embeddings will be permanently deleted.')}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteConfirmKb(null)}>
              {t('Cancel')}
            </Button>
            <Button color="red" onClick={handleDeleteKb}>
              {t('Delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      {!isUnsupportedPlatform && (
        <Stack gap="xl">
          {kbList.length === 0 ? (
            <Paper withBorder p="xl" style={{ textAlign: 'center' }}>
              <Stack gap="md" align="center">
                <ScalableIcon icon={IconInfoCircle} size={48} color="var(--chatbox-tint-tertiary)" />
                <Stack gap="xs" align="center">
                  <Text fw={500} size="lg">
                    {t('No Knowledge Base Yet')}
                  </Text>
                  <Text size="sm" c="dimmed" style={{ maxWidth: 400 }}>
                    {t(
                      'Create your first knowledge base to start adding documents and enhance your AI conversations with contextual information.'
                    )}
                  </Text>
                </Stack>
                <Button variant="outline" onClick={() => setShowCreate(true)} size="sm">
                  <Group gap="xs">
                    <ScalableIcon icon={IconPlus} size={16} />
                    {t('Create First Knowledge Base')}
                  </Group>
                </Button>
              </Stack>
            </Paper>
          ) : (
            kbList.map((kb) => (
              <Paper key={kb.id} withBorder p="md">
                <Stack gap="md">
                  <Stack gap="0">
                    <Group justify="space-between" align="center">
                      <Text fw={600} size="lg">
                        {kb.name}
                      </Text>
                      <Button size="xs" variant="subtle" onClick={() => handleEditKb(kb)}>
                        {t('Edit')}
                      </Button>
                    </Group>
                    <Group gap="xs" wrap="wrap" align="center">
                      {kb.embeddingModel?.startsWith('chatbox-ai') ? (
                        <>
                          <Text size="xs" c="dimmed">
                            {t('Models')}:
                          </Text>
                          <ModelPill
                            modelValue={'Chatbox AI'}
                            formatModelName={() => 'Chatbox AI'}
                            isProviderAvailable={() => canUseChatboxAIProvider}
                            type="embedding"
                            t={t}
                          />
                        </>
                      ) : (
                        <>
                          <Text size="xs" c="dimmed">
                            {t('Embedding')}:
                          </Text>
                          <ModelPill
                            modelValue={kb.embeddingModel}
                            formatModelName={formatModelName}
                            isProviderAvailable={isProviderAvailable}
                            type="embedding"
                            t={t}
                          />
                          <Text size="xs" c="dimmed">
                            {t('Rerank')}:
                          </Text>
                          <ModelPill
                            modelValue={kb.rerankModel}
                            formatModelName={formatModelName}
                            isProviderAvailable={isProviderAvailable}
                            type="rerank"
                            t={t}
                          />
                          <Text size="xs" c="dimmed">
                            {t('Vision')}:
                          </Text>
                          <ModelPill
                            modelValue={kb.visionModel}
                            formatModelName={formatModelName}
                            isProviderAvailable={isProviderAvailable}
                            type="vision"
                            t={t}
                          />
                        </>
                      )}
                    </Group>
                  </Stack>
                  <KnowledgeBaseDocuments knowledgeBase={kb} />
                </Stack>
              </Paper>
            ))
          )}
        </Stack>
      )}
    </Stack>
  )
}

export default KnowledgeBasePage
