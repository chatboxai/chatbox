import { resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { SessionHeader } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { SessionSettingsContent } from '@/components/session/SessionSettingsContent'
import { applySessionEdit, type SessionEdit } from '@/components/session/session-edit'
import { SettingsDensityProvider } from '@/components/settings/SettingsLayout'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import { getSessionAgentModeEntry } from '@/stores/session/agent-mode'

/**
 * Conversation settings for a chat that is not saved yet, such as the new-chat page. Changes apply
 * to the draft immediately; the dialog resolves with the edited draft when it closes. Saved
 * conversations edit their settings in the side panel instead.
 */
const SessionSettingsModal = NiceModal.create(
  ({ session, systemPrompt = '' }: { session: SessionHeader; systemPrompt?: string }) => {
    const modal = useModal()
    const { t } = useTranslation()
    const isSmallScreen = useIsSmallScreen()
    const [draft, setDraft] = useState<SessionHeader>(session)
    // Edits land here synchronously so closing resolves the latest draft, including text that a
    // field commits as it loses focus.
    const draftRef = useRef(session)
    const [prompt, setPrompt] = useState(systemPrompt)
    const promptRef = useRef(systemPrompt)

    useEffect(() => {
      draftRef.current = session
      setDraft(session)
      promptRef.current = systemPrompt
      setPrompt(systemPrompt)
    }, [session, systemPrompt])

    const onEdit = (edit: SessionEdit) => {
      draftRef.current = applySessionEdit(draftRef.current, edit)
      setDraft(draftRef.current)
      if (edit.systemPrompt !== undefined) {
        promptRef.current = edit.systemPrompt
        setPrompt(edit.systemPrompt)
      }
    }

    useEffect(() => {
      trackingEvent('chat_config_window', { event_category: 'screen_view' })
    }, [])

    const close = () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      modal.resolve({ session: draftRef.current, systemPrompt: promptRef.current })
      void modal.hide()
    }

    const mode = resolveSessionMode(getSessionAgentModeEntry(session.id, session).value)

    return (
      <AdaptiveModal
        opened={modal.visible}
        onClose={close}
        centered
        size="lg"
        title={t('Conversation Settings')}
        onFocus={(e) => e.stopPropagation()}
        trapFocus={false}
      >
        <SettingsDensityProvider density={isSmallScreen ? 'touch' : 'compact'}>
          <SessionSettingsContent session={draft} draftSystemPrompt={prompt} mode={mode} onEdit={onEdit} />
        </SettingsDensityProvider>
        <AdaptiveModal.Actions>
          <Button data-testid={TestId.settings.sessionSave} onClick={close}>
            {t('Done')}
          </Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    )
  }
)

export default SessionSettingsModal
