import { isActionAvailableInMode, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { ActionIcon, Box, Button, FileButton, Flex, Input, Stack, Switch, Text, Textarea } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { chatSessionSettings } from '@shared/defaults'
import { createMessage, isChatSession, ModelProviderEnum, type Session } from '@shared/types'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION, shouldPauseOnToolCallLimit } from '@shared/utils/tool-call-limit-pause'
import { IconTrash, IconUpload } from '@tabler/icons-react'
import { pick } from 'lodash'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { AssistantAvatar } from '@/components/common/Avatar'
import LazyNumberInput from '@/components/common/LazyNumberInput'
import MaxContextMessageCountSlider from '@/components/common/MaxContextMessageCountSlider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SliderWithInput from '@/components/common/SliderWithInput'
import { TooltipInfoTrigger } from '@/components/common/TooltipInfoTrigger'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { getSessionAgentModeEntry } from '@/stores/session/agent-mode'
import { getSessionMeta } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
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
        void rendererApplication.sessions.updateSessionWithMessages(editingData.id, (s) => {
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

    // Work Mode ignores the conversation's system prompt at request time — its
    // identity comes from the global Soul — so the field is not offered. The
    // stored prompt is left untouched.
    const showSystemPrompt = isActionAvailableInMode(
      'session-system-prompt',
      resolveSessionMode(getSessionAgentModeEntry(session.id, session).value)
    )

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
                        radius="lg"
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
                data-testid={TestId.settings.sessionName}
                placeholder={t('Name')}
                autoFocus={!isSmallScreen}
                value={editingData.name}
                onChange={(e) => setEditingData({ ...editingData, name: e.target.value })}
                classNames={{
                  input: '!text-chatbox-tint-primary',
                }}
              />
            </Stack>

            {isChatSession(session) && (
              <>
                {showSystemPrompt && (
                  <Textarea
                    data-testid={TestId.settings.sessionPrompt}
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
                )}

                <Stack gap="xs">
                  <Flex align="center" justify="space-between">
                    <Text fw={700}>{t('Specific model settings')}</Text>
                    <Button size="compact-sm" color="chatbox-brand" variant="transparent" onClick={onReset} fw={600}>
                      {t('Reset')}
                    </Button>
                  </Flex>

                  <Box p="sm" className="border border-solid border-chatbox-border-primary rounded-lg">
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
                  </Box>
                </Stack>
              </>
            )}

            <Stack gap="xs">
              <Text fw={600}>{t('Background Settings')}</Text>
              <Flex
                align="center"
                gap="sm"
                wrap="wrap"
                className="p-sm border border-solid border-chatbox-border-primary rounded-lg"
              >
                <Flex align="center" gap="xxs">
                  <Text>{t('Background Image')}</Text>
                  <Tooltip
                    label={t('Support jpg or png file smaller than 5MB. Overrides global background when set.')}
                    withArrow
                    offset={4}
                    maw={320}
                    className="!whitespace-normal"
                    zIndex={3000}
                    openOnTouch
                  >
                    <TooltipInfoTrigger label={t('Background Image')} />
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
                      radius="lg"
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
          <Button data-testid={TestId.settings.sessionSave} onClick={onSave}>
            {t('Save')}
          </Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    )
  }
)

export default SessionSettingsModal

export function ChatConfig({
  settings,
  onSettingsChange,
}: {
  settings: Session['settings']
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const globalSettingsStream = useSettingsStore((s) => s.stream)
  const globalPauseOnToolCallLimit = useSettingsStore((s) => s.pauseOnToolCallLimit)

  return (
    <Stack gap="md">
      <MaxContextMessageCountSlider
        inputTestId={TestId.settings.sessionMaxContext}
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
            openOnTouch
          >
            <TooltipInfoTrigger label={t('Temperature')} />
          </Tooltip>
        </Flex>

        <SliderWithInput
          inputTestId={TestId.settings.sessionTemperature}
          value={settings?.temperature}
          onChange={(v) => onSettingsChange({ temperature: v })}
          max={2}
        />
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
            openOnTouch
          >
            <TooltipInfoTrigger label="Top P" />
          </Tooltip>
        </Flex>

        <SliderWithInput
          inputTestId={TestId.settings.sessionTopP}
          value={settings?.topP}
          onChange={(v) => onSettingsChange({ topP: v })}
          max={1}
        />
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
            openOnTouch
          >
            <TooltipInfoTrigger label={t('Max Output Tokens')} />
          </Tooltip>
        </Flex>

        <LazyNumberInput
          inputTestId={TestId.settings.sessionMaxTokens}
          width={96}
          value={settings?.maxTokens}
          onChange={(v) => onSettingsChange({ maxTokens: typeof v === 'number' ? v : undefined })}
          min={1}
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

      <Stack gap="xs" py="xs">
        <Flex align="center" justify="space-between" gap="xs">
          <Flex align="center" gap="xs">
            <Text size="sm" fw="600">
              {t('Pause after every {{count}} steps', { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION })}
            </Text>
            <Tooltip
              label={t(
                "Long tasks pause for confirmation after every {{count}} steps so you can check they're on track. Turn off to let them run uninterrupted.",
                { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION }
              )}
              withArrow={true}
              maw={320}
              className="!whitespace-normal"
              zIndex={3000}
              openOnTouch
            >
              <TooltipInfoTrigger
                label={t('Pause after every {{count}} steps', { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION })}
              />
            </Tooltip>
          </Flex>
          <Switch
            data-testid={TestId.settings.sessionPauseOnToolCallLimitSwitch}
            checked={shouldPauseOnToolCallLimit(settings, { pauseOnToolCallLimit: globalPauseOnToolCallLimit })}
            onChange={(v) => onSettingsChange({ pauseOnToolCallLimit: v.target.checked })}
          />
        </Flex>
      </Stack>
    </Stack>
  )
}
