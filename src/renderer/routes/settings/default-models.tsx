/** biome-ignore-all lint/style/noNonNullAssertion: <todo> */
import { Flex, Stack, Text, Title } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { SystemProviders } from '@shared/defaults'
import { IconSelector } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { forwardRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import ModelSelector from '@/components/ModelSelector'
import { enrichModelsFromRegistry, useModelRegistryVersion } from '@/packages/model-registry'
import { useSettingsStore } from '@/stores/settingsStore'
import { isEmbeddingModel, isRerankModel } from './-defaultModelFilters'

export const Route = createFileRoute('/settings/default-models')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const chatboxAIAutoText = settings.licenseKey ? t('Auto (Use Chatbox AI)')! : t('None')!

  return (
    <Stack p="md" gap="xl">
      <Title order={5}>{t('Default Models')}</Title>

      <Stack gap="xs">
        <Text fw={600}>{t('Default Chat Model')}</Text>

        <ModelSelector
          position="bottom-start"
          transitionProps={{
            transition: 'fade-down',
            duration: 200,
          }}
          keepMounted
          width={320}
          showAuto={true}
          autoText={t('Auto (Use Last Used)')!}
          selectedProviderId={settings.defaultChatModel?.provider}
          selectedModelId={settings.defaultChatModel?.model}
          searchPosition="top"
          onSelect={(provider, model) => {
            setSettings({
              defaultChatModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }}
        >
          <ModelSelectContent
            autoText={t('Auto (Use Last Used)')!}
            provider={settings.defaultChatModel?.provider}
            model={settings.defaultChatModel?.model}
            testId={TestId.settings.defaultChatModel}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {t('Chatbox will use this model as the default for new chats.')}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Text fw={600}>{t('Default Thread Naming Model')}</Text>

        <ModelSelector
          position="bottom-start"
          width={320}
          showAuto={true}
          autoText={t('Auto (Use Chat Model)')!}
          selectedProviderId={settings.threadNamingModel?.provider}
          selectedModelId={settings.threadNamingModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              threadNamingModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={t('Auto (Use Chat Model)')!}
            provider={settings.threadNamingModel?.provider}
            model={settings.threadNamingModel?.model}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {t('Chatbox will automatically use this model to rename threads.')}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Text fw={600}>{t('Search Term Construction Model')}</Text>

        <ModelSelector
          position="bottom-start"
          width={320}
          showAuto={true}
          autoText={t('Auto (Use Chat Model)')!}
          selectedProviderId={settings.searchTermConstructionModel?.provider}
          selectedModelId={settings.searchTermConstructionModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              searchTermConstructionModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={t('Auto (Use Chat Model)')!}
            provider={settings.searchTermConstructionModel?.provider}
            model={settings.searchTermConstructionModel?.model}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {t('Chatbox will automatically use this model to construct search term.')}
        </Text>
      </Stack>
      <Stack gap="xs">
        <Text fw={600}>{t('OCR Model')}</Text>

        <ModelSelector
          position="bottom-start"
          showAuto={true}
          autoText={settings.licenseKey ? t('Auto (Use Chatbox AI)')! : t('None')!}
          width={320}
          modelFilter={(model) => model.capabilities?.includes('vision') ?? false}
          selectedProviderId={settings.ocrModel?.provider}
          selectedModelId={settings.ocrModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              ocrModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={settings.licenseKey ? t('Auto (Use Chatbox AI)')! : t('None')!}
            provider={settings.ocrModel?.provider}
            model={settings.ocrModel?.model}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {t('Chatbox OCRs images with this model and sends the text to models without image support.')}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Text fw={600}>{t('Default Embedding Model')}</Text>

        <ModelSelector
          position="bottom-start"
          showAuto={true}
          autoText={chatboxAIAutoText}
          width={320}
          modelFilter={isEmbeddingModel}
          selectedProviderId={settings.defaultEmbeddingModel?.provider}
          selectedModelId={settings.defaultEmbeddingModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              defaultEmbeddingModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={chatboxAIAutoText}
            provider={settings.defaultEmbeddingModel?.provider}
            model={settings.defaultEmbeddingModel?.model}
            modelType="embedding"
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {t('When selected, Chatbox will use this model instead of the automatic Chatbox AI embedding model.')}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Text fw={600}>{t('Default Reranking Model')}</Text>

        <ModelSelector
          position="bottom-start"
          showAuto={true}
          autoText={chatboxAIAutoText}
          width={320}
          modelFilter={isRerankModel}
          selectedProviderId={settings.defaultRerankModel?.provider}
          selectedModelId={settings.defaultRerankModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              defaultRerankModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={chatboxAIAutoText}
            provider={settings.defaultRerankModel?.provider}
            model={settings.defaultRerankModel?.model}
            modelType="rerank"
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {t('When selected, Chatbox will use this model instead of the automatic Chatbox AI reranking model.')}
        </Text>
      </Stack>
    </Stack>
  )
}

const ModelSelectContent = forwardRef<
  HTMLButtonElement,
  {
    provider?: string
    model?: string
    autoText?: string
    onClick?: () => void
    modelType?: 'chat' | 'embedding' | 'rerank'
    testId?: string
  }
>(({ provider, model, autoText, onClick, modelType, testId }, ref) => {
  useModelRegistryVersion()

  const { t } = useTranslation()
  const customProviders = useSettingsStore((state) => state.customProviders)
  const providers = useSettingsStore((state) => state.providers)
  const modelOptions = useMemo(() => {
    if (!provider) return []
    const rawModels =
      providers?.[provider]?.models ||
      SystemProviders().find((candidate) => candidate.id === provider)?.defaultSettings?.models ||
      []
    return enrichModelsFromRegistry(rawModels, provider).filter((candidate) =>
      modelType ? candidate.type === modelType : true
    )
  }, [provider, providers, modelType])
  const displayText = useMemo(
    () =>
      !provider || !model
        ? autoText || t('Auto')
        : ([...SystemProviders(), ...(customProviders || [])].find((p) => p.id === provider)?.name || provider) +
          '/' +
          (modelOptions.find((candidate) => candidate.modelId === model)?.nickname || model),
    [provider, model, autoText, t, customProviders, modelOptions]
  )
  return (
    <Flex
      ref={ref}
      px={12}
      py={6}
      component="button"
      data-testid={testId}
      align="center"
      c="chatbox-tertiary"
      w={320}
      className="border-solid border border-chatbox-border-primary rounded-lg cursor-pointer bg-transparent"
      onClick={onClick}
    >
      <Text span flex={1} className=" text-left">
        {displayText}
      </Text>
      <ScalableIcon icon={IconSelector} className=" text-inherit" />
    </Flex>
  )
})
