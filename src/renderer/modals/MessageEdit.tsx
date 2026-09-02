import { getSessionActionGate } from '@chatbox/core/session/action-gates'
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Combobox, Input, InputBase, Stack, Text, Textarea, useCombobox } from '@mantine/core'
import { findMessageLocation } from '@shared/session/message-forks'
import { type Message, type MessageContentParts, type MessageRole, MessageRoleEnum } from '@shared/types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { AssistantAvatar, SystemAvatar, UserAvatar } from '@/components/common/Avatar'
import { rendererApplication } from '@/app/renderer-application'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { getSessionLockStateNow } from '@/stores/session/action-guard'
import { saveAndResendMessage } from '@/stores/session/generation'
import { modifyMessage } from '@/stores/session/messages'
import * as toastActions from '@/stores/toastActions'
import { notifySessionLockBlocked } from '@/utils/session-lock-copy'

const MessageEdit = NiceModal.create(
  (props: { sessionId: string; msg: Message; hideSaveAndResend?: boolean; resendOnly?: boolean }) => {
    const modal = useModal()

    if (!props.msg) {
      return null
    }

    return (
      <MessageEditModal
        key={`${props.msg.id}-${modal.visible}`}
        sessionId={props.sessionId}
        msg={props.msg}
        opened={modal.visible}
        hideSaveAndResend={props.hideSaveAndResend}
        resendOnly={props.resendOnly}
        onClose={() => {
          modal.resolve()
          modal.hide()
        }}
      />
    )
  }
)

export default MessageEdit

const MessageEditModal = ({
  sessionId,
  msg: origMsg,
  opened,
  onClose,
  hideSaveAndResend,
  resendOnly,
}: {
  sessionId: string
  msg: Message
  opened: boolean
  onClose(): void
  hideSaveAndResend?: boolean
  /**
   * Work mode: editing must resend (append-only history — a silent save would
   * rewrite context the assistant never saw). Hides plain Save and locks the
   * role selector; Ctrl+Enter maps to Save & Resend.
   */
  resendOnly?: boolean
}) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  // Store initial content for dirty checking
  const [initialMsg] = useState<Message>(() => ({
    ...origMsg,
    contentParts: origMsg.contentParts.length ? origMsg.contentParts : [{ type: 'text', text: '' }],
  }))

  const [msg, _setMsg] = useState<Message>({
    ...origMsg,
    contentParts: origMsg.contentParts.length ? origMsg.contentParts : [{ type: 'text', text: '' }],
  })
  const setMsg = useCallback((m: Partial<Message>) => {
    _setMsg((_m) => ({ ..._m, ...m }))
  }, [])

  // State for confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // Check if content has been modified
  const isDirty = useMemo(() => {
    // Compare role
    if (msg.role !== initialMsg.role) {
      return true
    }
    // Compare content parts
    if (msg.contentParts.length !== initialMsg.contentParts.length) {
      return true
    }
    for (let i = 0; i < msg.contentParts.length; i++) {
      const currentPart = msg.contentParts[i]
      const initialPart = initialMsg.contentParts[i]
      if (currentPart.type !== initialPart.type) {
        return true
      }
      if (currentPart.type === 'text' && initialPart.type === 'text') {
        if (currentPart.text !== initialPart.text) {
          return true
        }
      }
    }
    return false
  }, [msg, initialMsg])

  // Create stable IDs for text parts to maintain focus
  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore contents change
  const textPartIds = useMemo(() => {
    const ids: string[] = []
    msg.contentParts.forEach((part, index) => {
      if (part.type === 'text') {
        ids[index] = `${msg.id}-text-${index}`
      }
    })
    return ids
  }, [msg.id])

  // Handle close with dirty check
  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowConfirmDialog(true)
    } else {
      onClose()
    }
  }, [isDirty, onClose])

  // Force close without checking
  const forceClose = useCallback(() => {
    setShowConfirmDialog(false)
    onClose()
  }, [onClose])

  // The modal can stay open long enough for the world to change (another
  // reply starts streaming, the message gets deleted from another surface),
  // so both actions read the live state at click time instead of holding a
  // subscription for their whole lifetime.
  const findLiveMessage = async (): Promise<Message | null | 'missing'> => {
    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
    if (!session) {
      return 'missing'
    }
    const location = findMessageLocation(session, msg.id)
    return location ? (location.list[location.index] ?? 'missing') : 'missing'
  }

  // Deleted elsewhere while the modal was open: there is nothing to save onto
  // or resend into. Both buttons converge here — tell the user and close
  // (skipping the dirty-check dialog on purpose: the edit has no target left,
  // so "continue editing" could never lead to a save).
  const closeForMissingMessage = () => {
    toastActions.add(t('This message has been deleted'), 2500)
    onClose()
  }

  const onSave = async () => {
    if (!msg) {
      return
    }
    const liveMessage = await findLiveMessage()
    if (liveMessage === 'missing') {
      closeForMissingMessage()
      return
    }
    if (liveMessage?.generating) {
      // Saving a snapshot of a streaming message would be silently
      // overwritten by the next chunk; keep the modal open so the edit
      // survives until the stream finishes.
      void notifySessionLockBlocked('message-streaming', t)
      return
    }
    void modifyMessage(sessionId, msg, true)
    onClose()
  }
  const onSaveAndReply = async () => {
    if (!msg) {
      return
    }
    // hideSaveAndResend only reflects the locks at modal-open; re-check with
    // live state so a generation started meanwhile still blocks the
    // regenerate-class action. Blocking keeps the modal open — the edit and
    // the resend intent both survive instead of being silently downgraded.
    // (A stream that starts in the instant after this check is caught by the
    // store-side guard inside saveAndResendMessage; in that residual race
    // the edit is saved in place and only the resend is stopped, with the
    // standard notice.)
    const liveMessage = await findLiveMessage()
    const locks = liveMessage === 'missing' ? null : await getSessionLockStateNow(sessionId)
    if (liveMessage === 'missing' || !locks) {
      closeForMissingMessage()
      return
    }
    const gate = getSessionActionGate('save-and-resend', locks, {
      messageGenerating: liveMessage?.generating === true,
    })
    if (!gate.allowed) {
      void notifySessionLockBlocked(gate.reason, t)
      return
    }
    onClose()
    void saveAndResendMessage(sessionId, msg)
  }

  const onContentPartInput = (index: number, text: string) => {
    if (!msg) {
      return
    }
    const newContentParts: MessageContentParts = [...msg.contentParts]
    if (newContentParts[index] && newContentParts[index].type === 'text') {
      newContentParts[index] = { type: 'text', text }
    }
    setMsg({
      contentParts: newContentParts,
    })
  }
  const handleTextPartKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    const target = event.target as HTMLTextAreaElement
    const cursorPosition = target.selectionStart
    const textLength = target.value.length

    // Find the indices of all text parts
    const textPartIndices: number[] = []
    msg.contentParts.forEach((part, idx) => {
      if (part.type === 'text') {
        textPartIndices.push(idx)
      }
    })

    const currentTextPartIndex = textPartIndices.indexOf(index)

    // Helper function to focus on another text part
    const focusTextPart = (targetIndex: number, cursorPos: 'start' | 'end') => {
      const element = document.getElementById(`${msg.id}-input-${targetIndex}`) as HTMLTextAreaElement
      if (element) {
        event.preventDefault()
        element.focus()
        setTimeout(() => {
          const position = cursorPos === 'start' ? 0 : element.value.length
          element.setSelectionRange(position, position)
        }, 0)
      }
    }

    const isAtStart = cursorPosition === 0
    const isAtEnd = cursorPosition === textLength
    const hasPrevious = currentTextPartIndex > 0
    const hasNext = currentTextPartIndex < textPartIndices.length - 1

    // Navigation logic
    const shouldNavigate =
      (event.key === 'ArrowUp' && isAtStart && hasPrevious) ||
      (event.key === 'ArrowLeft' && isAtStart && hasPrevious) ||
      (event.key === 'Backspace' && isAtStart && hasPrevious && target.selectionStart === target.selectionEnd)

    if (shouldNavigate) {
      focusTextPart(textPartIndices[currentTextPartIndex - 1], 'end')
    } else if (
      (event.key === 'ArrowDown' && isAtEnd && hasNext) ||
      (event.key === 'ArrowRight' && isAtEnd && hasNext)
    ) {
      focusTextPart(textPartIndices[currentTextPartIndex + 1], 'start')
    }

    // Handle the original keyboard shortcuts
    onKeyDown(event)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!msg) {
      return
    }
    const ctrlOrCmd = event.ctrlKey || event.metaKey
    const shift = event.shiftKey

    // ctrl + shift + enter 保存并生成 (skip if hideSaveAndResend is true)
    if (event.key === 'Enter' && ctrlOrCmd && shift && (!hideSaveAndResend || resendOnly)) {
      event.preventDefault()
      void onSaveAndReply()
      return
    }
    // ctrl + enter 保存（resend-only 模式下等同保存并生成）
    if (event.key === 'Enter' && ctrlOrCmd && !shift) {
      event.preventDefault()
      void (resendOnly ? onSaveAndReply() : onSave())
      return
    }
  }

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  const avatars = {
    [MessageRoleEnum.System]: <SystemAvatar size={36} />,
    [MessageRoleEnum.Assistant]: <AssistantAvatar size={36} />,
    [MessageRoleEnum.User]: <UserAvatar size={36} />,
    [MessageRoleEnum.Tool]: null,
  }

  if (!msg) {
    return null
  }

  return (
    <>
      <AdaptiveModal
        opened={opened}
        centered
        size="lg"
        onClose={handleClose}
        keepMounted={false}
        lockScroll={false}
        trapFocus={false}
      >
        <Stack gap="md" className="max-h-[70vh] overflow-y-auto -m-3 p-3">
          <Combobox
            store={combobox}
            classNames={{ dropdown: 'pointer-events-auto' }}
            onOptionSubmit={(val) => {
              setMsg({
                role: val as MessageRole,
              })
              combobox.closeDropdown()
            }}
          >
            <Combobox.Target>
              <InputBase
                component="button"
                type="button"
                classNames={{ root: 'self-start', input: 'p-xs pr-8 h-auto ' }}
                pointer={!resendOnly}
                rightSection={resendOnly ? undefined : <Combobox.Chevron />}
                rightSectionPointerEvents="none"
                onClick={() => {
                  if (!resendOnly) combobox.toggleDropdown()
                }}
              >
                {msg.role ? avatars[msg.role] : <Input.Placeholder>Pick value</Input.Placeholder>}
              </InputBase>
            </Combobox.Target>

            <Combobox.Dropdown>
              <Combobox.Options>
                {[MessageRoleEnum.System, MessageRoleEnum.Assistant, MessageRoleEnum.User].map((r) => (
                  <Combobox.Option value={r} key={r}>
                    {avatars[r]}
                  </Combobox.Option>
                ))}
              </Combobox.Options>
            </Combobox.Dropdown>
          </Combobox>
          {msg.contentParts.filter((part) => part.type === 'text').length === 0 ? (
            <Textarea
              id={`${msg.id}-input`}
              autoFocus={!isSmallScreen}
              autosize
              minRows={5}
              maxRows={15}
              placeholder="prompt"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setMsg({
                    contentParts: [{ type: 'text', text: e.target.value }],
                  })
                }
              }}
              onKeyDown={onKeyDown}
              styles={{
                input: { touchAction: 'manipulation' },
              }}
            />
          ) : (
            msg.contentParts.map((part, index, arr) => {
              if (part.type === 'text') {
                return (
                  <Textarea
                    key={textPartIds[index] || `text-part-${index}`}
                    id={`${msg.id}-input-${index}`}
                    autoFocus={!isSmallScreen && index === 0}
                    autosize
                    minRows={arr.length > 1 ? 1 : 5}
                    maxRows={15}
                    placeholder="prompt"
                    value={part.text}
                    onChange={(e) => onContentPartInput(index, e.target.value)}
                    onKeyDown={(e) => handleTextPartKeyDown(e, index)}
                    styles={{
                      input: { touchAction: 'manipulation' },
                    }}
                  />
                )
              }
              return null
            })
          )}
        </Stack>

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={handleClose} />
          {(!hideSaveAndResend || resendOnly) && (
            <Button onClick={onSaveAndReply} variant={resendOnly ? 'filled' : 'light'}>
              {t('Save & Resend')}
            </Button>
          )}
          {!resendOnly && <Button onClick={onSave}>{t('Save')}</Button>}
        </AdaptiveModal.Actions>
      </AdaptiveModal>

      {/* Confirmation Dialog for Unsaved Changes */}
      <AdaptiveModal
        opened={showConfirmDialog}
        centered
        size="sm"
        onClose={() => setShowConfirmDialog(false)}
        title={t('Discard Changes?')}
      >
        <Stack gap="md">
          <Text size="sm">{t('You have unsaved changes. Exiting will discard these changes.')}</Text>
          <AdaptiveModal.Actions>
            <Button variant="light" onClick={() => setShowConfirmDialog(false)}>
              {t('Continue Editing')}
            </Button>
            <Button color="red" onClick={forceClose}>
              {t('Discard Changes')}
            </Button>
          </AdaptiveModal.Actions>
        </Stack>
      </AdaptiveModal>
    </>
  )
}
