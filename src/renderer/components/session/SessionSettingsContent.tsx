import { isActionAvailableInMode, type SessionMode } from '@chatbox/core/session/mode-policy'
import {
  Anchor,
  Box,
  Button,
  FileButton,
  Flex,
  NumberInput,
  SegmentedControl,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { isChatSession, ModelProviderEnum, type Session, type SessionSettings } from '@shared/types'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION, shouldPauseOnToolCallLimit } from '@shared/utils/tool-call-limit-pause'
import { IconArrowBackUp, IconTrash } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { AssistantAvatar } from '@/components/common/Avatar'
import { ICON_STROKE_WIDTH } from '@/components/common/IconButton'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import {
  ContextLimitSelectRow,
  describeSamplingValue,
  NO_CONTEXT_LIMIT,
  SamplingParamControl,
  useSamplingFieldShown,
} from '@/components/settings/ParamControl'
import {
  InheritState,
  SettingRow,
  SettingSwitchRow,
  SettingsSection,
  useSettingsDensity,
} from '@/components/settings/SettingsLayout'
import { useFieldDraft } from '@/hooks/useFieldDraft'
import { useProviders } from '@/hooks/useProviders'
import { navigateToSettings } from '@/modals/settings-navigation'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import {
  countSessionDifferences,
  inheritedParameterValue,
  restoreSessionParameters,
  type SessionParameterKey,
  visibleSessionParameterKeys,
} from '@/stores/session/session-settings-inheritance'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { getSessionSystemPrompt, type SessionEdit } from './session-edit'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const TEXT_COMMIT_DELAY_MS = 600
const UNDO_VISIBLE_MS = 8000

/**
 * Text field that applies its value shortly after typing stops, on blur and when it unmounts.
 * `allowEmpty: false` rejects blank text, and the field shows the stored text again.
 */
function useCommittedText(value: string, commit: (value: string) => void, allowEmpty = true) {
  const { draft, setDraft, flush } = useFieldDraft(
    value,
    (next) => {
      if (!allowEmpty && next.trim() === '') return 'rejected'
      // Saved text is trimmed, so whitespace-only changes leave it as it is.
      if (next.trim() === value.trim()) return 'unchanged'
      commit(next)
      return 'applied'
    },
    TEXT_COMMIT_DELAY_MS
  )
  return { value: draft, onChange: setDraft, onBlur: flush }
}

function useModelLabel(settings: SessionSettings | undefined) {
  const { providers } = useProviders()
  return useMemo(() => {
    if (!settings?.modelId) return undefined
    const provider = providers.find((item) => item.id === settings.provider)
    const model = provider?.models?.find((item) => item.modelId === settings.modelId)
    return model?.nickname || settings.modelId
  }, [providers, settings?.provider, settings?.modelId])
}

/**
 * Conversation settings shared by the desktop side panel, the small-screen bottom sheet and the
 * new-chat dialog. Every change applies immediately through `onEdit`; each parameter says whether
 * it follows the global default or overrides it.
 */
export function SessionSettingsContent({
  session,
  mode,
  onEdit,
}: {
  session: Session
  mode: SessionMode
  onEdit: (edit: SessionEdit) => void
}) {
  const { t } = useTranslation()
  const density = useSettingsDensity()
  const global = {
    maxContextMessageCount: useSettingsStore((s) => s.maxContextMessageCount),
    temperature: useSettingsStore((s) => s.temperature),
    topP: useSettingsStore((s) => s.topP),
    stream: useSettingsStore((s) => s.stream),
    pauseOnToolCallLimit: useSettingsStore((s) => s.pauseOnToolCallLimit),
  }
  const settings = session.settings
  const modelLabel = useModelLabel(settings)
  const keys = visibleSessionParameterKeys(settings)
  const overrideCount = countSessionDifferences(settings, keys, global)
  const isChat = isChatSession(session)
  const showSystemPrompt = isActionAvailableInMode('session-system-prompt', mode)

  const name = useCommittedText(session.name, (value) => onEdit({ name: value }), false)
  const systemPrompt = useCommittedText(getSessionSystemPrompt(session), (value) => onEdit({ systemPrompt: value }))

  const setParam = (patch: Partial<SessionSettings>) => onEdit({ settings: patch })
  const temperatureFieldShown = useSamplingFieldShown('temperature')
  const temperatureControl = (fieldId?: string) => (
    <SamplingParamControl
      inputId={fieldId}
      kind="temperature"
      clearable={settings?.temperature !== undefined}
      inputTestId={TestId.settings.sessionTemperature}
      value={settings?.temperature ?? global.temperature}
      onChange={(value) => setParam({ temperature: value })}
    />
  )
  const restore = (key: SessionParameterKey) => setParam(restoreSessionParameters([key]))
  // Undo sits beside the action rather than in a toast: a modal sheet blocks taps outside itself.
  const [undoPatch, setUndoPatch] = useState<Partial<SessionSettings> | null>(null)
  useEffect(() => {
    if (!undoPatch) return
    const timer = setTimeout(() => setUndoPatch(null), UNDO_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [undoPatch])
  const restoreAll = () => {
    setUndoPatch(Object.fromEntries(keys.map((key) => [key, settings?.[key]])) as Partial<SessionSettings>)
    setParam(restoreSessionParameters(keys))
  }
  const inherit = (key: SessionParameterKey, inheritedValue: string, testId?: string) => (
    <InheritState
      overridden={settings?.[key] !== undefined}
      inheritedValue={inheritedValue}
      onRestore={() => restore(key)}
      testId={testId}
    />
  )

  return (
    <div className="flex flex-col gap-5" data-testid={TestId.sessionPanel.settings}>
      <Flex align="center" gap="sm">
        <FileButton
          accept="image/png,image/jpeg"
          onChange={(file) => {
            if (!file) return
            const key = StorageKeyGenerator.picture(`assistant-avatar:${session.id}`)
            handleImageInputAndSave(
              file,
              key,
              () => onEdit({ assistantAvatarKey: key }),
              (k, v) => currentBlobStorage.set(k, v)
            )
          }}
        >
          {(props) => (
            <UnstyledButton
              {...props}
              aria-label={t('Change avatar') ?? undefined}
              className="relative shrink-0 rounded-full"
            >
              <AssistantAvatar
                size={40}
                avatarKey={session.assistantAvatarKey}
                picUrl={session.picUrl}
                sessionType={session.type}
              />
            </UnstyledButton>
          )}
        </FileButton>
        <TextInput
          flex={1}
          data-testid={TestId.settings.sessionName}
          aria-label={t('Name') ?? undefined}
          placeholder={t('Name') ?? ''}
          value={name.value}
          onChange={(e) => name.onChange(e.currentTarget.value)}
          onBlur={name.onBlur}
          size={density === 'touch' ? 'md' : 'sm'}
        />
        {session.assistantAvatarKey && (
          <Button
            variant="subtle"
            color="chatbox-gray"
            size="compact-xs"
            onClick={() => onEdit({ assistantAvatarKey: null })}
          >
            {t('Reset avatar')}
          </Button>
        )}
      </Flex>

      {isChat &&
        (showSystemPrompt ? (
          <SettingsSection title={t('Instruction')} bare>
            <Textarea
              data-testid={TestId.settings.sessionPrompt}
              aria-label={t('Instruction (System Prompt)') ?? undefined}
              placeholder={t('Copilot Prompt Demo') || ''}
              autosize
              minRows={2}
              maxRows={10}
              value={systemPrompt.value}
              onChange={(e) => systemPrompt.onChange(e.currentTarget.value)}
              onBlur={systemPrompt.onBlur}
              styles={{ input: { touchAction: 'manipulation' } }}
            />
          </SettingsSection>
        ) : (
          <Text fz={12} c="chatbox-tertiary" lh="18px">
            {t('Work Mode uses the agent persona instead of a conversation prompt.')}{' '}
            <Anchor fz={12} component="button" onClick={() => navigateToSettings('/agent')}>
              {t('Edit persona')}
            </Anchor>
          </Text>
        ))}

      {isChat && (
        <SettingsSection
          title={t('Model parameters')}
          action={
            modelLabel ? (
              <Text fz={12} c="chatbox-tertiary" truncate maw="60%">
                {t('Applies to {{model}}', { model: modelLabel })}
              </Text>
            ) : undefined
          }
          footer={
            <ContextLimitSelectRow
              testId={TestId.sessionPanel.inheritMaxContext}
              selectTestId={TestId.settings.sessionMaxContext}
              value={settings?.maxContextMessageCount}
              inheritedValue={global.maxContextMessageCount ?? NO_CONTEXT_LIMIT}
              onChange={(value) => setParam({ maxContextMessageCount: value })}
              onInherit={() => restore('maxContextMessageCount')}
            />
          }
        >
          <SettingRow
            label={t('Temperature')}
            status={inherit(
              'temperature',
              describeSamplingValue(global.temperature, t),
              TestId.sessionPanel.inheritTemperature
            )}
            controlLayout="block"
            control={temperatureFieldShown ? temperatureControl : temperatureControl()}
          />
          <SettingRow
            label="Top P"
            status={inherit('topP', describeSamplingValue(global.topP, t))}
            controlLayout="block"
            control={(fieldId) => (
              <SamplingParamControl
                inputId={fieldId}
                kind="topP"
                clearable={settings?.topP !== undefined}
                inputTestId={TestId.settings.sessionTopP}
                value={settings?.topP ?? global.topP}
                onChange={(value) => setParam({ topP: value })}
              />
            )}
          />
          <SettingRow
            label={t('Max Output Tokens')}
            description={t('Keep within the range the model accepts')}
            status={
              settings?.maxTokens !== undefined ? <RestoreLink onRestore={() => restore('maxTokens')} /> : undefined
            }
            control={(fieldId) => (
              <MaxTokensInput
                inputId={fieldId}
                value={settings?.maxTokens}
                onChange={(value) => setParam({ maxTokens: value })}
              />
            )}
          />
          {settings?.provider === ModelProviderEnum.Claude && (
            <SettingRow
              label={t('Prompt cache duration')}
              description={t('Claude only')}
              status={
                settings.claudePromptCacheTTL ? (
                  <RestoreLink onRestore={() => restore('claudePromptCacheTTL')} />
                ) : undefined
              }
              controlLayout="block"
              control={
                <SegmentedControl
                  data-testid={TestId.settings.sessionClaudePromptCacheTTL}
                  aria-label={t('Prompt cache duration') ?? undefined}
                  size="xs"
                  radius="md"
                  fullWidth
                  value={settings.claudePromptCacheTTL ?? 'auto'}
                  onChange={(value) =>
                    setParam({ claudePromptCacheTTL: value === '5m' || value === '1h' ? value : undefined })
                  }
                  data={[
                    { label: t('Auto'), value: 'auto' },
                    { label: t('5 min'), value: '5m' },
                    { label: t('1 hour'), value: '1h' },
                  ]}
                />
              }
            />
          )}
          {settings?.provider !== ModelProviderEnum.ChatboxAI && (
            <SettingSwitchRow
              label={t('Stream output')}
              status={inherit('stream', (global.stream ?? true) ? t('On') : t('Off'))}
              checked={settings?.stream ?? global.stream ?? true}
              onChange={(checked) => setParam({ stream: checked })}
            />
          )}
          <SettingSwitchRow
            label={t('Pause after every {{count}} steps', { count: MAX_TOOL_CALLS_BEFORE_CONFIRMATION })}
            switchTestId={TestId.settings.sessionPauseOnToolCallLimitSwitch}
            status={inherit(
              'pauseOnToolCallLimit',
              inheritedParameterValue('pauseOnToolCallLimit', global, settings) ? t('On') : t('Off')
            )}
            checked={shouldPauseOnToolCallLimit(settings, { pauseOnToolCallLimit: global.pauseOnToolCallLimit })}
            onChange={(checked) => setParam({ pauseOnToolCallLimit: checked })}
          />
        </SettingsSection>
      )}

      <SettingsSection title={t('Background')}>
        <SettingRow
          label={t('Background Image')}
          description={t('Overrides the global background for this chat')}
          control={
            <Flex align="center" gap="xs">
              {session.backgroundImage?.type === 'storage-key' && (
                <Box w={40} h={28} className="overflow-hidden rounded bg-chatbox-background-secondary">
                  <ImageInStorage
                    storageKey={session.backgroundImage.storageKey}
                    className="object-cover w-full h-full"
                  />
                </Box>
              )}
              <FileButton
                accept="image/png,image/jpeg"
                onChange={(file) => {
                  if (!file) return
                  if (file.size > MAX_IMAGE_SIZE) {
                    addToast(t('Support jpg or png file smaller than 5MB'))
                    return
                  }
                  const key = StorageKeyGenerator.picture(`session-bg:${session.id}`)
                  handleImageInputAndSave(
                    file,
                    key,
                    () => onEdit({ backgroundImage: { type: 'storage-key', storageKey: key } }),
                    (k, v) => currentBlobStorage.set(k, v)
                  )
                }}
              >
                {(props) => (
                  <Button {...props} variant="default" size="compact-sm">
                    {session.backgroundImage ? t('Change') : t('Upload')}
                  </Button>
                )}
              </FileButton>
              {session.backgroundImage && (
                <Button
                  variant="subtle"
                  color="chatbox-gray"
                  size="compact-sm"
                  aria-label={t('Remove') ?? undefined}
                  onClick={() => onEdit({ backgroundImage: null })}
                >
                  <ScalableIcon icon={IconTrash} size={14} />
                </Button>
              )}
            </Flex>
          }
        />
      </SettingsSection>

      {isChat && (
        <Flex
          align="center"
          justify="space-between"
          gap="sm"
          className="border-0 border-t border-solid border-chatbox-border-primary pt-3"
          data-testid={TestId.sessionPanel.overrideSummary}
        >
          <Text fz={12} c={overrideCount > 0 ? 'chatbox-brand' : 'chatbox-tertiary'}>
            {overrideCount > 0
              ? t('{{count}} differ from global defaults', { count: overrideCount })
              : undoPatch
                ? t('Restored to global defaults')
                : t('All parameters follow global defaults')}
          </Text>
          {undoPatch && overrideCount === 0 && (
            <Button
              variant="subtle"
              size="compact-xs"
              data-testid={TestId.sessionPanel.undoRestore}
              onClick={() => {
                setParam(undoPatch)
                setUndoPatch(null)
              }}
            >
              {t('Undo')}
            </Button>
          )}
          {overrideCount > 0 && (
            <Button
              variant="subtle"
              size="compact-xs"
              onClick={restoreAll}
              data-testid={TestId.sessionPanel.restoreAll}
            >
              {t('Restore all')}
            </Button>
          )}
        </Flex>
      )}
    </div>
  )
}

function MaxTokensInput({
  value,
  onChange,
  inputId,
}: {
  value?: number
  onChange: (value?: number) => void
  inputId?: string
}) {
  const { t } = useTranslation()
  const { draft, setDraft, flush } = useFieldDraft<string | number>(value ?? '', (next) => {
    const parsed = typeof next === 'number' ? next : Number.parseInt(next, 10)
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    if (limit === value) return 'unchanged'
    onChange(limit)
    return 'applied'
  })
  return (
    <NumberInput
      id={inputId}
      data-testid={TestId.settings.sessionMaxTokens}
      w={112}
      size="xs"
      min={1}
      step={1024}
      allowDecimal={false}
      allowNegative={false}
      hideControls
      placeholder={t('Model default') ?? ''}
      aria-label={t('Max Output Tokens') ?? undefined}
      value={draft}
      onChange={setDraft}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      inputMode="numeric"
      enterKeyHint="done"
    />
  )
}

function RestoreLink({ onRestore }: { onRestore: () => void }) {
  const { t } = useTranslation()
  return (
    <span className="flex items-center gap-1.5 min-h-[18px]" data-inherit-state="overridden">
      <span className="inline-block size-1.5 rounded-full bg-chatbox-tint-brand" aria-hidden />
      <UnstyledButton
        onClick={onRestore}
        className="flex items-center gap-0.5 rounded px-1 text-xs leading-[18px] text-chatbox-tint-secondary hover:bg-chatbox-background-gray-secondary"
      >
        <ScalableIcon icon={IconArrowBackUp} size={12} strokeWidth={ICON_STROKE_WIDTH} />
        {t('Restore')}
      </UnstyledButton>
    </span>
  )
}
