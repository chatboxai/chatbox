import NiceModal, { useModal } from '@ebay/nice-modal-react'
import {
  ActionIcon,
  Box,
  Button,
  FileButton,
  Flex,
  Input,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { chatSessionSettings, pictureSessionSettings } from '@shared/defaults'
import {
  createMessage,
  isChatSession,
  isPictureSession,
  ModelProviderEnum,
  type Session,
  type SessionSettings,
} from '@shared/types'
import {
  getReasoningControlLevel,
  getReasoningControlOptions,
  getReasoningProviderOptions,
  type ReasoningControlLevel,
  type ReasoningControlOption,
} from '@shared/utils/reasoning-control'
import { IconInfoCircle, IconTrash, IconUpload } from '@tabler/icons-react'
import { pick } from 'lodash'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { AssistantAvatar } from '@/components/common/Avatar'
import LazyNumberInput from '@/components/common/LazyNumberInput'
import MaxContextMessageCountSlider from '@/components/common/MaxContextMessageCountSlider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SegmentedControl from '@/components/common/SegmentedControl'
import SliderWithInput from '@/components/common/SliderWithInput'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import ImageStyleSelect from '@/components/ImageStyleSelect'
import { resolveReasoningModelInfo } from '@/components/InputBox/useReasoningControlState'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { updateSessionWithMessages } from '@/stores/chatStore'
import { getSessionMeta, mergeSettings } from '@/stores/sessionHelpers'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { getMessageText } from '../../shared/utils/message'

const SessionSettingsModal = NiceModal.create(
  ({ session, disableAutoSave = false }: { session: Session; disableAutoSave?: boolean }) => {
    const modal = useModal()
    const { t } = useTranslation()
    const isSmallScreen = useIsSmallScreen()

    const [editingData, setEditingData] = useState<Session | null>(session || null)
    useEffect(() => {
      if (!session) {
        setEditingData(null)
      } else {
        setEditingData({
          ...session,
          settings: session.settings ? { ...session.settings } : undefined,
        })
      }
    }, [session])

    const [systemPrompt, setSystemPrompt] = useState('')
    useEffect(() => {
      if (!session) {
        setSystemPrompt('')
      } else {
        const systemMessage = session.messages.find((m) => m.role === 'system')
        setSystemPrompt(systemMessage ? getMessageText(systemMessage) : '')
      }
    }, [session])

    const onReset = (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      setEditingData((_editingData) =>
        _editingData
          ? {
              ..._editingData,
              settings: pick(_editingData.settings, ['provider', 'modelId']),
            }
          : _editingData
      )
    }

    useEffect(() => {
      if (session) {
        trackingEvent('chat_config_window', { event_category: 'screen_view' })
      }
    }, [session])

    const onCancel = () => {
      if (session) {
        setEditingData({
          ...session,
        })
      }
      modal.resolve()
      modal.hide()
    }

    const applySessionChanges = (target: Session) => {
      target.name = (target.name ?? '').trim() || session.name
      const trimmed = systemPrompt.trim()
      const messages = Array.isArray(target.messages) ? [...target.messages] : []
      if (trimmed === '') {
        target.messages = messages.filter((m) => m.role !== 'system')
      } else {
        const idx = messages.findIndex((m) => m.role === 'system')
        if (idx >= 0) {
          const sys = { ...messages[idx], contentParts: [{ type: 'text' as const, text: trimmed }] }
          target.messages = [...messages.slice(0, idx), sys, ...messages.slice(idx + 1)]
        } else {
          target.messages = [createMessage('system', trimmed), ...messages]
        }
      }
      return target
    }
    const onSave = () => {
      if (!session || !editingData) {
        return
      }

      if (!disableAutoSave) {
        void updateSessionWithMessages(editingData.id, (s) => {
          const merged = {
            ...(s ?? {}),
            ...getSessionMeta(editingData),
            settings: editingData.settings,
          } as Session

          return applySessionChanges(merged)
        })
      } else {
        applySessionChanges(editingData)
      }

      // setChatConfigDialogSessionId(null)
      modal.resolve(editingData)
      modal.hide()
    }

    if (!session || !editingData) {
      return null
    }

    return (
      <AdaptiveModal
        opened={modal.visible}
        onClose={() => {
          modal.resolve()
          modal.hide()
        }}
        // fullScreen={isSmallScreen}
        centered
        size="lg"
        title={t('Conversation Settings')}
        onFocus={(e) => e.stopPropagation()}
        trapFocus={false}
        // fullWidth
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto', overflowX: 'hidden' }}>
          <Stack>
            <FileButton
              accept="image/png,image/jpeg"
              onChange={(file) => {
                if (file) {
                  const key = StorageKeyGenerator.picture(`assistant-avatar:${session?.id}`)
                  handleImageInputAndSave(
                    file,
                    key,
                    () => setEditingData((prev) => ({ ...prev, assistantAvatarKey: key }) as typeof prev),
                    (k, v) => storage.setBlob(k, v)
                  )
                }
              }}
            >
              {(props) => (
                <Flex justify="center">
                  <Flex className="relative">
                    <AssistantAvatar
                      size={isSmallScreen ? 64 : 80}
                      avatarKey={editingData.assistantAvatarKey}
                      picUrl={editingData.picUrl}
                      sessionType={editingData.type}
                      {...props}
                    />

                    {editingData.assistantAvatarKey && (
                      <ActionIcon
                        color="chatbox-error"
                        size={24}
                        radius="xl"
                        bottom={0}
                        right={0}
                        className="absolute"
                        onClick={() => {
                          setEditingData({ ...editingData, assistantAvatarKey: undefined })
                        }}
                      >
                        <ScalableIcon icon={IconTrash} size={18} />
                      </ActionIcon>
                    )}
                  </Flex>
                </Flex>
              )}
            </FileButton>

            <Stack gap="xs">
              <Text fw={700}>{t('Name')}</Text>
              <Input
                placeholder={t('Name')}
                autoFocus={!isSmallScreen}
                value={editingData.name}
                onChange={(e) => setEditingData({ ...editingData, name: e.target.value })}
                classNames={{
                  input: '!text-chatbox-tint-primary',
                }}
              />
            </Stack>

            <Textarea
              label={t('Instruction (System Prompt)')}
              placeholder={t('Copilot Prompt Demo') || ''}
              autosize
              minRows={2}
              maxRows={12}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              classNames={{
                input: '!text-chatbox-tint-primary',
              }}
              styles={{
                input: { touchAction: 'manipulation' },
              }}
            />

            <Stack gap="xs">
              <Flex align="center" justify="space-between">
                <Text fw={700}>{t('Specific model settings')}</Text>
                <Button size="compact-sm" color="chatbox-brand" variant="transparent" onClick={onReset} fw={600}>
                  {t('Reset')}
                </Button>
              </Flex>

              <Box p="sm" className="border border-solid border-chatbox-border-primary rounded-md">
                {isChatSession(session) && (
                  <ChatConfig
                    settings={editingData.settings}
                    onSettingsChange={(d) =>
                      setEditingData((_data) => {
                        if (_data) {
                          return {
                            ..._data,
                            settings: {
                              ..._data?.settings,
                              ...d,
                            },
                          }
                        } else {
                          return null
                        }
                      })
                    }
                  />
                )}
                {isPictureSession(session) && <PictureConfig dataEdit={editingData} setDataEdit={setEditingData} />}
              </Box>
            </Stack>

            <Stack gap="xs">
              <Text fw={600}>{t('Background Settings')}</Text>
              <Flex
                align="center"
                gap="sm"
                wrap="wrap"
                className="p-sm border border-solid border-chatbox-border-primary rounded-md"
              >
                <Flex align="center" gap="xxs">
                  <Text>{t('Background Image')}</Text>
                  <Tooltip
                    label={t('Support jpg or png file smaller than 5MB. Overrides global background when set.')}
                    withArrow
                    offset={4}
                  >
                    <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
                  </Tooltip>
                </Flex>

                <div className="flex-1" />

                <FileButton
                  accept="image/png,image/jpeg"
                  onChange={(file) => {
                    if (file) {
                      if (file.size > 5 * 1024 * 1024) {
                        addToast(t('Support jpg or png file smaller than 5MB'))
                        return
                      }
                      const key = StorageKeyGenerator.picture(`session-bg:${session.id}`)
                      handleImageInputAndSave(
                        file,
                        key,
                        () =>
                          setEditingData({ ...editingData, backgroundImage: { type: 'storage-key', storageKey: key } }),
                        (k, v) => storage.setBlob(k, v)
                      )
                    }
                  }}
                >
                  {(props) => (
                    <Button {...props} variant="default" size="compact-sm">
                      <ScalableIcon icon={IconUpload} size={12} className="mr-xs" />
                      {t('Upload')}
                    </Button>
                  )}
                </FileButton>

                {editingData.backgroundImage?.type === 'storage-key' ? (
                  <Box w={48} h={48} className="relative overflow-hidden rounded bg-chatbox-tertiary/20 flex-shrink-0">
                    <ImageInStorage
                      storageKey={editingData.backgroundImage.storageKey}
                      className="object-cover w-full h-full"
                    />

                    <ActionIcon
                      color="chatbox-error"
                      size={20}
                      radius={10}
                      bottom={3}
                      right={3}
                      className="absolute"
                      onClick={() => {
                        if (editingData.backgroundImage) {
                          if (editingData.backgroundImage.type === 'storage-key') {
                            storage.removeItem(editingData.backgroundImage.storageKey)
                          }
                          setEditingData({ ...editingData, backgroundImage: undefined })
                        }
                      }}
                    >
                      <ScalableIcon icon={IconTrash} size={16} />
                    </ActionIcon>
                  </Box>
                ) : null}
              </Flex>
            </Stack>
          </Stack>
        </div>

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onCancel} />
          <Button onClick={onSave}>{t('Save')}</Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    )
  }
)

export default SessionSettingsModal

function getReasoningOptionLabel(option: ReasoningControlOption, t: (key: string) => string): string {
  switch (option.label) {
    case 'default':
      return t('Default')
    case 'off':
      return t('Off')
    case 'on':
      return t('On')
    case 'low':
      return t('Low')
    case 'medium':
      return t('Medium')
    case 'high':
      return t('High')
  }
}

// Unified thinking control driven by the shared reasoning-control semantics, replacing
// the previous per-provider controls (Claude budget, OpenAI effort, Gemini budget/level).
// Reads and writes the same providerOptions as the input-box ReasoningControlButton so
// both surfaces always agree on levels and request parameters.
function ReasoningControlConfig({
  settings,
  onSettingsChange,
}: {
  settings: Session['settings']
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const provider = settings?.provider
  const modelId = settings?.modelId

  const modelInfo = useMemo(() => {
    if (!provider || !modelId) return null
    const providerInfo = providers.find((item) => item.id === provider)
    return resolveReasoningModelInfo({ provider, modelId }, providerInfo)
  }, [providers, provider, modelId])

  const options = useMemo(() => getReasoningControlOptions(provider, modelInfo), [provider, modelInfo])
  const level = useMemo(
    () => getReasoningControlLevel(provider, modelInfo, settings?.providerOptions),
    [provider, modelInfo, settings?.providerOptions]
  )

  const handleChange = useCallback(
    (value: string) => {
      onSettingsChange({
        providerOptions: getReasoningProviderOptions(
          provider,
          modelInfo,
          value as ReasoningControlLevel,
          settings?.providerOptions
        ),
      })
    },
    [onSettingsChange, provider, modelInfo, settings?.providerOptions]
  )

  if (options.length === 0) {
    return null
  }

  return (
    <Stack gap="md" style={{ minWidth: 0 }}>
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Effort')}
        </Text>
        <Tooltip
          label={t('Default sends no thinking parameters and lets the model decide')}
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>

      <div style={{ minWidth: 0, overflowX: 'auto' }}>
        <SegmentedControl
          key={`reasoning-control:${options.map((o) => o.level).join(',')}`}
          value={level}
          onChange={handleChange}
          data={options.map((o) => ({ label: getReasoningOptionLabel(o, t), value: o.level }))}
        />
      </div>
    </Stack>
  )
}

export function ChatConfig({
  settings,
  onSettingsChange,
}: {
  settings: Session['settings']
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const globalSettingsStream = useSettingsStore((s) => s.stream)

  return (
    <Stack gap="md">
      <MaxContextMessageCountSlider
        value={settings?.maxContextMessageCount ?? chatSessionSettings().maxContextMessageCount!}
        onChange={(v) => onSettingsChange({ maxContextMessageCount: v })}
      />

      <Stack gap="xs">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            {t('Temperature')}
          </Text>
          <Tooltip
            label={t(
              'Modify the creativity of AI responses; the higher the value, the more random and intriguing the answers become, while a lower value ensures greater stability and reliability.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <SliderWithInput value={settings?.temperature} onChange={(v) => onSettingsChange({ temperature: v })} max={2} />
      </Stack>

      <Stack gap="xs">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            Top P
          </Text>
          <Tooltip
            label={t(
              'The topP parameter controls the diversity of AI responses: lower values make the output more focused and predictable, while higher values allow for more varied and creative replies.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <SliderWithInput value={settings?.topP} onChange={(v) => onSettingsChange({ topP: v })} max={1} />
      </Stack>

      <Flex justify="space-between" align="center">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            {t('Max Output Tokens')}
          </Text>
          <Tooltip
            label={t(
              'Set the maximum number of tokens for model output. Please set it within the acceptable range of the model, otherwise errors may occur.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <LazyNumberInput
          width={96}
          value={settings?.maxTokens}
          onChange={(v) => onSettingsChange({ maxTokens: typeof v === 'number' ? v : undefined })}
          min={settings?.provider === ModelProviderEnum.Perplexity ? 16 : 0}
          step={1024}
          allowDecimal={false}
          placeholder={t('Not set') || ''}
        />
      </Flex>

      {settings?.provider !== ModelProviderEnum.ChatboxAI && (
        <Stack gap="xs" py="xs">
          <Flex align="center" justify="space-between" gap="xs">
            <Text size="sm" fw="600">
              {t('Stream output')}
            </Text>
            <Switch
              checked={settings?.stream ?? globalSettingsStream ?? true}
              onChange={(v) => onSettingsChange({ stream: v.target.checked })}
            />
          </Flex>
        </Stack>
      )}

      <ReasoningControlConfig settings={settings} onSettingsChange={onSettingsChange} />
    </Stack>
  )
}

function PictureConfig(props: { dataEdit: Session; setDataEdit: (data: Session) => void }) {
  const { t } = useTranslation()
  const { dataEdit, setDataEdit } = props
  const globalSettings = settingsStore.getState().getSettings()
  const sessionSettings = mergeSettings(globalSettings, dataEdit.settings || {}, dataEdit.type || 'chat')
  const updateSettingsEdit = (updated: Partial<SessionSettings>) => {
    setDataEdit({
      ...dataEdit,
      settings: {
        ...(dataEdit.settings || {}),
        ...updated,
      },
    })
  }
  return (
    <Stack gap="md" className="my-4">
      <ImageStyleSelect
        value={sessionSettings.dalleStyle || pictureSessionSettings().dalleStyle!}
        onChange={(v) => updateSettingsEdit({ dalleStyle: v })}
        className={sessionSettings.dalleStyle === undefined ? 'opacity-50' : ''}
      />
      <Stack>
        <Text size="sm" fw="600">
          {t('Number of Images per Reply')}
        </Text>
        <Slider
          value={sessionSettings.imageGenerateNum || pictureSessionSettings().imageGenerateNum!}
          onChange={(v) => updateSettingsEdit({ imageGenerateNum: v })}
          min={1}
          max={10}
          step={1}
          marks={Array.from({ length: 10 }).map((_, i) => ({
            value: i + 1,
          }))}
        />
      </Stack>
    </Stack>
  )
}
