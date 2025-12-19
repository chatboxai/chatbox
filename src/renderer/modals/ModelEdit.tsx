import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Checkbox, Flex, Loader, NumberInput, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderModelInfo } from 'src/shared/types'
import { createModelDependencies } from '@/adapters'
import { Modal } from '@/components/Overlay'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { type ModelTestState, testModelCapabilities } from '@/utils/model-tester'

const ModelEdit = NiceModal.create((props: { model?: ProviderModelInfo; providerId?: string }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state)

  const isNew = !props.model
  const [modelId, setModelId] = useState(props.model?.modelId || '')
  const [nickname, setNickname] = useState(props.model?.nickname || '')
  const [capabilities, setCapabilities] = useState(props.model?.capabilities || [])
  const [type, setType] = useState<ProviderModelInfo['type']>(props.model?.type || 'chat')
  const [contextWindow, setContextWindow] = useState<number | undefined>(props.model?.contextWindow)
  const [maxOutput, setMaxOutput] = useState<number | undefined>(props.model?.maxOutput)
  const [testState, setTestState] = useState<ModelTestState>({
    testing: false,
  })

  const typeOptions = [
    { value: 'chat', label: t('Chat')?.toString() ?? 'Chat' },
    { value: 'embedding', label: t('Embedding')?.toString() ?? 'Embedding' },
    { value: 'rerank', label: t('Rerank')?.toString() ?? 'Rerank' },
  ]

  useEffect(() => {
    setModelId(props.model?.modelId || '')
    setNickname(props.model?.nickname || '')
    setCapabilities(props.model?.capabilities || [])
    setType(props.model?.type || 'chat')
    setContextWindow(props.model?.contextWindow)
    setMaxOutput(props.model?.maxOutput)
    setTestState({ testing: false })
  }, [props])

  const handleTestModel = async () => {
    if (!modelId || !props.providerId) return

    const configs = await platform.getConfig()
    const dependencies = await createModelDependencies()

    await testModelCapabilities({
      providerId: props.providerId,
      modelId,
      settings,
      configs,
      dependencies,
      onStateChange: (state) => {
        setTestState(state)

        // Auto-enable capabilities based on test results
        if (state.visionTest?.status === 'success') {
          setCapabilities((prev = []) => (prev.includes('vision') ? prev : [...prev, 'vision']))
        }
        if (state.toolTest?.status === 'success') {
          setCapabilities((prev = []) => (prev.includes('tool_use') ? prev : [...prev, 'tool_use']))
        }
      },
    })
  }

  const handleCancel = () => {
    modal.resolve()
    modal.hide()
  }

  const handleSave = () => {
    modal.resolve({
      modelId,
      type,
      nickname: nickname || undefined,
      capabilities,
      contextWindow,
      maxOutput,
    })
    modal.hide()
  }

  return (
    <Modal
      keepMounted={false}
      opened={modal.visible}
      onClose={handleCancel}
      title={t('Edit Model')}
      centered={true}
      w={456}
    >
      <Stack gap="md">
        {/* Model ID & NickName */}
        <Stack gap="xs">
          <Flex align="center" gap="lg">
            <Stack gap={0}>
              <Text>{t('Model ID')}</Text>
              <Text className="select-none h-0 overflow-hidden opacity-0">{t('Nickname')}</Text>
            </Stack>
            <TextInput disabled={!isNew} flex={1} value={modelId} onChange={(e) => setModelId(e.currentTarget.value)} />
          </Flex>
          <Flex align="center" gap="lg">
            <Stack gap={0}>
              <Text className="select-none h-0 overflow-hidden opacity-0">{t('Model ID')}</Text>
              <Text>{t('Nickname')}</Text>
            </Stack>
            <TextInput
              placeholder={String(t('optional') ?? 'optional')}
              flex={1}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </Flex>
        </Stack>

        {/* Model Type */}
        <Stack gap="xs">
          <Text fw="600">{t('Model Type')}</Text>
          <Select
            comboboxProps={{ withinPortal: false }}
            allowDeselect={false}
            styles={{
              label: {
                fontWeight: 400,
              },
            }}
            data={typeOptions}
            value={type}
            onChange={(v) => setType(v as ProviderModelInfo['type'])}
          />
        </Stack>

        {/* Capabilities */}
        {type === 'chat' && (
          <Stack gap="xs">
            <Text fw="600">{t('Capabilities')}</Text>
            <Flex align="center" gap="md">
              <Checkbox
                flex={1}
                label={t('Vision')}
                checked={capabilities?.includes('vision')}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  if (checked) {
                    setCapabilities([...(capabilities || []), 'vision'])
                  } else {
                    setCapabilities([...(capabilities?.filter((c) => c !== 'vision') || [])])
                  }
                }}
              />
              <Checkbox
                flex={1}
                label={t('Reasoning')}
                checked={capabilities?.includes('reasoning')}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  if (checked) {
                    setCapabilities([...(capabilities || []), 'reasoning'])
                  } else {
                    setCapabilities([...(capabilities?.filter((c) => c !== 'reasoning') || [])])
                  }
                }}
              />
              <Checkbox
                flex={1}
                label={t('Tool use')}
                checked={capabilities?.includes('tool_use')}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  if (checked) {
                    setCapabilities([...(capabilities || []), 'tool_use'])
                  } else {
                    setCapabilities([...(capabilities?.filter((c) => c !== 'tool_use') || [])])
                  }
                }}
              />
            </Flex>
          </Stack>
        )}

        {/* Context Window and Max Output */}
        <Stack gap="xs">
          <Text fw="600">{t('Advanced Settings')}</Text>
          <Flex gap="md">
            <Stack gap="xs" flex={1}>
              <Text size="sm">{t('Context Window')}</Text>
              <NumberInput
                placeholder={String(t('e.g. 128000'))}
                value={contextWindow}
                onChange={(value) => setContextWindow(typeof value === 'number' ? value : undefined)}
                min={1}
                max={10_000_000}
                step={1000}
                thousandSeparator=","
                clampBehavior="strict"
              />
            </Stack>
            <Stack gap="xs" flex={1}>
              <Text size="sm">{t('Max Output Tokens')}</Text>
              <NumberInput
                placeholder={String(t('e.g. 4096'))}
                value={maxOutput}
                onChange={(value) => setMaxOutput(typeof value === 'number' ? value : undefined)}
                min={1}
                max={1_000_000}
                step={100}
                thousandSeparator=","
                clampBehavior="strict"
              />
            </Stack>
          </Flex>
        </Stack>

        <Flex align="center" justify="flex-end" gap="xs">
          <Text>
            {testState.basicTest?.status === 'success' ? (
              <Text c="chatbox-success">{t('Test successful')}</Text>
            ) : testState.basicTest?.status === 'error' ? (
              <Tooltip label={testState.basicTest.error} multiline maw={300}>
                <Text c="chatbox-error" style={{ cursor: 'help' }}>
                  {t('Test failed')}
                </Text>
              </Tooltip>
            ) : null}
          </Text>
          <Button onClick={handleCancel} color="chatbox-gray" variant="light">
            {t('Cancel')}
          </Button>
          <Button variant="light" onClick={handleTestModel}>
            {testState.testing ? <Loader size="xs" /> : t('Test Model')}
          </Button>
          <Button onClick={handleSave}>{t('Save')}</Button>
        </Flex>
      </Stack>
    </Modal>
  )
})

export default ModelEdit
