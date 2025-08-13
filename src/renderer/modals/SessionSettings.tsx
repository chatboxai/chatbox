import NiceModal, { muiDialogV5, useModal } from '@ebay/nice-modal-react'
import { Flex, Stack, Switch, Text, Tooltip } from '@mantine/core'
import ImageIcon from '@mui/icons-material/Image'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import { IconInfoCircle } from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import { pick } from 'lodash'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chatSessionSettings, pictureSessionSettings } from 'src/shared/defaults'
import {
  createMessage,
  isChatSession,
  isPictureSession,
  ModelProviderEnum,
  type Session,
  type SessionSettings,
  type Settings,
} from '@/../shared/types'
import { Accordion, AccordionDetails, AccordionSummary } from '@/components/Accordion'
import EditableAvatar from '@/components/EditableAvatar'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import ImageCountSlider from '@/components/ImageCountSlider'
import ImageStyleSelect from '@/components/ImageStyleSelect'
import LazyNumberInput from '@/components/LazyNumberInput'
import MaxContextMessageCountSlider from '@/components/MaxContextMessageCountSlider'
import SegmentedControl from '@/components/SegmentedControl'
import SliderWithInput from '@/components/SliderWithInput'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as atoms from '@/stores/atoms'
import * as sessionActions from '@/stores/sessionActions'
import { saveSession } from '@/stores/sessionStorageMutations'
import { getMessageText } from '@/utils/message'

const SessionSettingsModal = NiceModal.create(
  ({ session, disableAutoSave = false }: { session: Session; disableAutoSave?: boolean }) => {
    const modal = useModal()
    const { t } = useTranslation()
    const isSmallScreen = useIsSmallScreen()
    const globalSettings = useAtomValue(atoms.settingsAtom)
    const theme = useTheme()

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
    const onSave = () => {
      if (!session || !editingData) {
        return
      }
      if (editingData.name === '') {
        editingData.name = session.name
      }
      editingData.name = editingData.name.trim()
      if (systemPrompt === '') {
        editingData.messages = editingData.messages.filter((m) => m.role !== 'system')
      } else {
        const systemMessage = editingData.messages.find((m) => m.role === 'system')
        if (systemMessage) {
          systemMessage.contentParts = [{ type: 'text', text: systemPrompt.trim() }]
        } else {
          editingData.messages.unshift(createMessage('system', systemPrompt.trim()))
        }
      }
      if (!disableAutoSave) {
        saveSession(editingData)
      }
      // setChatConfigDialogSessionId(null)
      modal.resolve(editingData)
      modal.hide()
    }

    if (!session || !editingData) {
      return null
    }

    return (
      <Dialog
        {...muiDialogV5(modal)}
        onClose={() => {
          modal.resolve()
          modal.hide()
        }}
        fullWidth
      >
        <DialogTitle>{t('Conversation Settings')}</DialogTitle>
        <DialogContent>
          <DialogContentText></DialogContentText>

          <EditableAvatar
            onChange={(event) => {
              if (!event.target.files) {
                return
              }
              const file = event.target.files[0]
              if (file) {
                const key = StorageKeyGenerator.picture(`assistant-avatar:${session?.id}`)
                handleImageInputAndSave(file, key, () => setEditingData({ ...editingData, assistantAvatarKey: key }))
              }
            }}
            onRemove={() => {
              setEditingData({ ...editingData, assistantAvatarKey: undefined })
            }}
            removable={!!editingData.assistantAvatarKey}
            sx={{
              backgroundColor:
                editingData.type === 'picture'
                  ? theme.palette.secondary.main
                  : editingData.picUrl
                    ? theme.palette.background.default
                    : theme.palette.primary.main,
            }}
          >
            {editingData.assistantAvatarKey ? (
              <ImageInStorage
                storageKey={editingData.assistantAvatarKey}
                className="object-cover object-center w-full h-full"
              />
            ) : editingData.picUrl ? (
              <img src={editingData.picUrl} className="object-cover object-center w-full h-full" />
            ) : editingData.type === 'picture' ? (
              <ImageIcon
                fontSize="large"
                sx={{
                  width: '60px',
                  height: '60px',
                }}
              />
            ) : globalSettings.defaultAssistantAvatarKey ? (
              <ImageInStorage
                storageKey={globalSettings.defaultAssistantAvatarKey}
                className="object-cover object-center w-full h-full"
              />
            ) : (
              <SmartToyIcon fontSize="large" />
            )}
          </EditableAvatar>
          <TextField
            autoFocus={!isSmallScreen}
            margin="dense"
            label={t('name')}
            type="text"
            fullWidth
            variant="outlined"
            value={editingData.name}
            onChange={(e) => setEditingData({ ...editingData, name: e.target.value })}
          />
          <div className="mt-1">
            <TextField
              margin="dense"
              label={t('Instruction (System Prompt)')}
              placeholder={t('Copilot Prompt Demo') || ''}
              fullWidth
              variant="outlined"
              multiline
              minRows={2}
              maxRows={8}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </div>

          <Accordion defaultExpanded={true} className="mt-2">
            <AccordionSummary aria-controls="panel1a-content">
              <div className="flex flex-row w-full justify-between items-center">
                <Typography>{t('Specific model settings')}</Typography>
              </div>
              {editingData.settings && (
                <Button size="small" variant="text" onClick={onReset}>
                  {t('Reset')}
                </Button>
              )}
            </AccordionSummary>
            <AccordionDetails>
              {/* <Text>{JSON.stringify(editingData.settings)}</Text> */}
              {isChatSession(session) && (
                <ChatConfig
                  settings={editingData.settings}
                  globalSettings={globalSettings}
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
            </AccordionDetails>
          </Accordion>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>{t('cancel')}</Button>
          <Button onClick={onSave}>{t('save')}</Button>
        </DialogActions>
      </Dialog>
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
    <Stack gap="md">
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
          <IconInfoCircle size={20} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
        </Tooltip>
      </Flex>

      <SegmentedControl
        key="thinking-budget-control"
        value={currentSegmentValue}
        onChange={handleThinkingConfigChange}
        data={thinkingBudgetOptions}
      />

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

function ClaudeProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const providerOptions = settings?.providerOptions?.claude || {}

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
      currentBudgetTokens={providerOptions.thinking?.budgetTokens || 1024}
      isEnabled={providerOptions.thinking?.type === 'enabled'}
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
  const providerOptions = settings?.providerOptions?.openai || {}

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
      const reasoningEffort = value === 'null' ? null : (value as 'low' | 'medium' | 'high')
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
    const effort = providerOptions.reasoningEffort
    return effort === null || effort === undefined ? 'null' : effort
  }, [providerOptions.reasoningEffort])

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
          <IconInfoCircle size={20} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
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
  const providerOptions = settings?.providerOptions?.google || {}

  const handleConfigChange = (config: { budgetTokens: number; enabled: boolean }) => {
    onSettingsChange({
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: config.budgetTokens, includeThoughts: config.enabled } },
      },
    })
  }

  return (
    <ThinkingBudgetConfig
      currentBudgetTokens={providerOptions.thinkingConfig?.thinkingBudget || 0}
      isEnabled={(providerOptions.thinkingConfig?.thinkingBudget || 0) > 0}
      onConfigChange={handleConfigChange}
      tooltipText={t('Thinking Budget only works for 2.0 or later models')}
      minValue={0}
      maxValue={10000}
    />
  )
}

export function ChatConfig({
  settings,
  onSettingsChange,
  globalSettings,
}: {
  settings: Session['settings']
  globalSettings: Settings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()

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
            <IconInfoCircle size={20} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
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
            <IconInfoCircle size={20} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
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
            <IconInfoCircle size={20} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
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
              checked={settings?.stream ?? globalSettings?.stream ?? true}
              onChange={(v) => onSettingsChange({ stream: v.target.checked })}
            />
          </Flex>
        </Stack>
      )}

      <Stack>
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
    </Stack>
  )
}

function PictureConfig(props: { dataEdit: Session; setDataEdit: (data: Session) => void }) {
  const { dataEdit, setDataEdit } = props
  const globalSettings = useAtomValue(atoms.settingsAtom)
  const sessionSettings = sessionActions.mergeSettings(globalSettings, dataEdit.settings || {}, dataEdit.type || 'chat')
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
    <Stack gap="md" className="mt-8">
      <ImageStyleSelect
        value={sessionSettings.dalleStyle || pictureSessionSettings().dalleStyle!}
        onChange={(v) => updateSettingsEdit({ dalleStyle: v })}
        className={sessionSettings.dalleStyle === undefined ? 'opacity-50' : ''}
      />
      <ImageCountSlider
        value={sessionSettings.imageGenerateNum || pictureSessionSettings().imageGenerateNum!}
        onChange={(v) => updateSettingsEdit({ imageGenerateNum: v })}
        className={sessionSettings.imageGenerateNum === undefined ? 'opacity-50' : ''}
      />
    </Stack>
  )
}
