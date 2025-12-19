/** biome-ignore-all lint/style/noNonNullAssertion: <todo> */
import { Flex, Stack, Text, Title } from '@mantine/core'
import { IconSelector } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { forwardRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemProviders } from 'src/shared/defaults'
import ModelSelector from '@/components/ModelSelector'
import { ScalableIcon } from '@/components/ScalableIcon'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/default-models')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

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
            console.log(provider, model)
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
    </Stack>
  )
}

const ModelSelectContent = forwardRef<
  HTMLButtonElement,
  { provider?: string; model?: string; autoText?: string; onClick?: () => void }
>(({ provider, model, autoText, onClick }, ref) => {
  const { t } = useTranslation()
  const customProviders = useSettingsStore((state) => state.customProviders)
  const providers = useSettingsStore((state) => state.providers)
  const displayText = useMemo(
    () =>
      !provider || !model
        ? autoText || t('Auto')
        : ([...SystemProviders, ...(customProviders || [])].find((p) => p.id === provider)?.name || provider) +
          '/' +
          ((providers?.[provider]?.models || SystemProviders[provider as any]?.defaultSettings?.models)?.find(
            (m) => m.modelId === model
          )?.nickname || model),
    [provider, model, autoText, t, customProviders, providers]
  )
  return (
    <Flex
      ref={ref}
      px={12}
      py={6}
      component="button"
      align="center"
      c="chatbox-tertiary"
      w={320}
      className="border-solid border border-chatbox-border-primary rounded-sm cursor-pointer bg-transparent"
      onClick={onClick}
    >
      <Text span flex={1} className=" text-left">
        {displayText}
      </Text>
      <ScalableIcon icon={IconSelector} className=" text-inherit" />
    </Flex>
  )
})
