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
  type GoogleThinkingLevel,
  getDefaultGoogleThinkingLevel,
  getGoogleThinkingMode,
  getSupportedGoogleThinkingLevels,
} from '@shared/utils/google-thinking'
import { IconInfoCircle, IconTrash, IconUpload } from '@tabler/icons-react'
import { pick } from 'lodash'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AssistantAvatar } from '@/components/common/Avatar'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import LazyNumberInput from '@/components/common/LazyNumberInput'
import MaxContextMessageCountSlider from '@/components/common/MaxContextMessageCountSlider'
import SliderWithInput from '@/components/common/SliderWithInput'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import ImageStyleSelect from '@/components/ImageStyleSelect'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { updateSession } from '@/stores/chatStore'
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
        void updateSession(editingData.id, (s) => {
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
                  handleImageInputAndSave(file, key, () => setEditingData({ ...editingData, assistantAvatarKey: key }))
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

interface ThinkingBudgetConfigProps {
  currentBudgetTokens: number
  isEnabled: boolean
  onConfigChange: (config: { budgetTokens: number; enabled: boolean }) => void
  tooltipText: string
  minValue?: number
  maxValue?: number
}

function ThinkingBudgetConfig({
  currentBudgetTokens,
  isEnabled,
  onConfigChange,
  tooltipText,
  minValue = 1024,
  maxValue = 10000,
}: ThinkingBudgetConfigProps) {
  const { t } = useTranslation()

  // Define preset values in one place
  const PRESET_VALUES = useMemo(() => [2048, 5120, 10240], [])

  const thinkingBudgetOptions = useMemo(
    () => [
      { label: t('Disabled'), value: 'disabled' },
      { label: `${t('Low')} (2K)`, value: PRESET_VALUES[0].toString() },
      { label: `${t('Medium')} (5K)`, value: PRESET_VALUES[1].toString() },
      { label: `${t('High')} (10K)`, value: PRESET_VALUES[2].toString() },
      { label: t('Custom'), value: 'custom' },
    ],
    [t, PRESET_VALUES]
  )

  // Add state to track custom mode selection
  const [isCustomMode, setIsCustomMode] = useState(false)
  const [userSelectedCustom, setUserSelectedCustom] = useState(false)

  // Initialize custom mode based on current budget tokens
  useEffect(() => {
    if (isEnabled) {
      const matchesPreset = PRESET_VALUES.includes(currentBudgetTokens)
      // Only auto-set custom mode if user hasn't manually selected custom and value doesn't match presets
      if (!matchesPreset && !isCustomMode && !userSelectedCustom) {
        setIsCustomMode(true)
      }
      // Don't override user's manual custom selection even if value matches preset
    } else {
      // Only reset if currently in custom mode
      if (isCustomMode || userSelectedCustom) {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
      }
    }
  }, [isEnabled, currentBudgetTokens, PRESET_VALUES, isCustomMode, userSelectedCustom])

  // Determine current segment value
  const getCurrentSegmentValue = useCallback(() => {
    if (!isEnabled) return 'disabled'

    if (isCustomMode || userSelectedCustom) return 'custom'

    const matchingPreset = PRESET_VALUES.find((preset) => preset === currentBudgetTokens)
    return matchingPreset ? matchingPreset.toString() : 'custom'
  }, [isEnabled, isCustomMode, userSelectedCustom, PRESET_VALUES, currentBudgetTokens])

  const handleThinkingConfigChange = useCallback(
    (value: string) => {
      if (value === 'disabled') {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
        onConfigChange({ budgetTokens: 0, enabled: false })
      } else if (value === 'custom') {
        setIsCustomMode(true)
        setUserSelectedCustom(true) // Mark that user manually selected custom
        // For disabled to custom switch, use a reasonable default
        const customValue = currentBudgetTokens > 0 ? currentBudgetTokens : minValue || PRESET_VALUES[0]
        onConfigChange({ budgetTokens: customValue, enabled: true })
      } else {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
        onConfigChange({ budgetTokens: parseInt(value), enabled: true })
      }
    },
    [currentBudgetTokens, minValue, PRESET_VALUES, onConfigChange]
  )

  const handleCustomBudgetChange = useCallback(
    (v: number | undefined) => {
      onConfigChange({ budgetTokens: v || minValue, enabled: true })
    },
    [minValue, onConfigChange]
  )

  const currentSegmentValue = getCurrentSegmentValue()

  return (
    <Stack gap="md" style={{ minWidth: 0 }}>
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Budget')}
        </Text>
        <Tooltip
          label={tooltipText}
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
          key="thinking-budget-control"
          value={currentSegmentValue}
          onChange={handleThinkingConfigChange}
          data={thinkingBudgetOptions}
          fullWidth={false}
        />
      </div>

      {currentSegmentValue === 'custom' && (
        <SliderWithInput
          min={minValue}
          max={maxValue}
          step={1}
          value={currentBudgetTokens}
          onChange={handleCustomBudgetChange}
        />
      )}
    </Stack>
  )
}

interface ThinkingLevelConfigProps {
  currentLevel: GoogleThinkingLevel
  supportedLevels: GoogleThinkingLevel[]
  onLevelChange: (thinkingLevel: GoogleThinkingLevel) => void
  tooltipText: string
}

function ThinkingLevelConfig({ currentLevel, supportedLevels, onLevelChange, tooltipText }: ThinkingLevelConfigProps) {
  const { t } = useTranslation()

  const thinkingLevelOptions = useMemo(
    () =>
      supportedLevels.map((level) => ({
        label:
          level === 'minimal'
            ? t('Minimal')
            : level === 'low'
              ? t('Low')
              : level === 'medium'
                ? t('Medium')
                : t('High'),
        value: level,
      })),
    [supportedLevels, t]
  )

  const handleThinkingLevelChange = useCallback(
    (value: string) => {
      onLevelChange(value as GoogleThinkingLevel)
    },
    [onLevelChange]
  )

  return (
    <Stack gap="md" style={{ minWidth: 0 }}>
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Level')}
        </Text>
        <Tooltip
          label={tooltipText}
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
          key={`thinking-level-control:${supportedLevels.join(',')}`}
          value={currentLevel}
          onChange={handleThinkingLevelChange}
          data={thinkingLevelOptions}
          fullWidth={false}
        />
      </div>
    </Stack>
  )
}

function ClaudeProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const providerOptions = settings?.providerOptions?.claude

  const handleConfigChange = (config: { budgetTokens: number; enabled: boolean }) => {
    onSettingsChange({
      providerOptions: {
        claude: {
          thinking: {
            type: config.enabled ? 'enabled' : 'disabled',
            budgetTokens: config.budgetTokens,
          },
        },
      },
    })
  }

  return (
    <ThinkingBudgetConfig
      currentBudgetTokens={providerOptions?.thinking?.budgetTokens || 1024}
      isEnabled={providerOptions?.thinking?.type === 'enabled'}
      onConfigChange={handleConfigChange}
      tooltipText={t('Thinking Budget only works for 3.7 or later models')}
      minValue={1024}
      maxValue={10000}
    />
  )
}

function OpenAIProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const providerOptions = settings?.providerOptions?.openai

  // Memoize options to prevent recreation on every render
  const reasoningEffortOptions = useMemo(
    () => [
      { label: t('Disabled'), value: 'null' },
      { label: t('Low'), value: 'low' },
      { label: t('Medium'), value: 'medium' },
      { label: t('High'), value: 'high' },
    ],
    [t]
  )

  const handleReasoningEffortChange = useCallback(
    (value: string) => {
      const reasoningEffort = value === 'null' ? undefined : (value as 'low' | 'medium' | 'high')
      onSettingsChange({
        providerOptions: {
          openai: { reasoningEffort },
        },
      })
    },
    [onSettingsChange]
  )

  // Simplify value calculation to avoid instability
  const currentValue = useMemo(() => {
    const effort = providerOptions?.reasoningEffort
    return effort === undefined ? 'null' : effort
  }, [providerOptions?.reasoningEffort])

  return (
    <Stack gap="md">
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Effort')}
        </Text>
        <Tooltip
          label={t('Thinking Effort only works for OpenAI o-series models')}
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>

      <SegmentedControl
        key="reasoning-effort-control"
        value={currentValue}
        onChange={handleReasoningEffortChange}
        data={reasoningEffortOptions}
      />
    </Stack>
  )
}

function GoogleProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const modelId = settings?.modelId || ''
  const providerOptions = settings?.providerOptions?.google
  const thinkingMode = getGoogleThinkingMode(modelId)
  const supportedLevels = useMemo(() => getSupportedGoogleThinkingLevels(modelId), [modelId])

  const handleBudgetConfigChange = (config: { budgetTokens: number; enabled: boolean }) => {
    onSettingsChange({
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: config.budgetTokens, includeThoughts: config.enabled } },
      },
    })
  }

  const handleLevelChange = useCallback(
    (thinkingLevel: GoogleThinkingLevel) => {
      onSettingsChange({
        providerOptions: {
          google: { thinkingConfig: { thinkingLevel, includeThoughts: true } },
        },
      })
    },
    [onSettingsChange]
  )

  const currentThinkingLevel = useMemo(() => {
    const thinkingLevel = providerOptions?.thinkingConfig?.thinkingLevel

    if (supportedLevels.length === 0) {
      return undefined
    }

    if (thinkingLevel && supportedLevels.includes(thinkingLevel)) {
      return thinkingLevel
    }

    return getDefaultGoogleThinkingLevel(modelId)
  }, [modelId, providerOptions?.thinkingConfig?.thinkingLevel, supportedLevels])

  if (thinkingMode === 'level' && currentThinkingLevel) {
    return (
      <ThinkingLevelConfig
        currentLevel={currentThinkingLevel}
        supportedLevels={supportedLevels}
        onLevelChange={handleLevelChange}
        tooltipText={t('Thinking Level only works for Gemini 3 models')}
      />
    )
  }

  if (thinkingMode !== 'budget') {
    return null
  }

  return (
    <ThinkingBudgetConfig
      currentBudgetTokens={providerOptions?.thinkingConfig?.thinkingBudget || 0}
      isEnabled={(providerOptions?.thinkingConfig?.thinkingBudget || 0) > 0}
      onConfigChange={handleBudgetConfigChange}
      tooltipText={t('Thinking Budget only works for Gemini 2.5 models')}
      minValue={0}
      maxValue={10000}
    />
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
          min={0}
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

      {settings?.provider === ModelProviderEnum.Claude && (
        <ClaudeProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
      )}
      {settings?.provider === ModelProviderEnum.OpenAI && (
        <OpenAIProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
      )}
      {settings?.provider === ModelProviderEnum.Gemini && (
        <GoogleProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
      )}
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
