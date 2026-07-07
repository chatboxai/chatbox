import { Box, Textarea } from '@mantine/core'
import type React from 'react'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useMessageInput } from '@/hooks/useMessageInput'
import { getSlashQuery } from '@/packages/skills/slash'
import { useEnabledSkills } from '@/packages/skills/useEnabledSkills'
import * as dom from '../../hooks/dom'
import SkillSlashMenu from './SkillSlashMenu'

// ============================================================================
// MessageInputField — isolated textarea to prevent parent re-renders on typing
// ============================================================================

export type MessageInputFieldRef = {
  getValue: () => string
  setValue: (val: string | ((prev: string) => string)) => void
  clearDraft: () => void
  getElement: () => HTMLTextAreaElement | null
}

type MessageInputFieldProps = {
  isNewSession: boolean
  isSmallScreen: boolean
  viewportHeight: number
  isReadOnly: boolean
  placeholder: string
  autoFocus: boolean
  /** Called on every value change (including programmatic setValue). */
  onValueChange: (value: string) => void
  /** Called only on real user typing (onChange), not programmatic setValue. */
  onUserInput?: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
}

export const MessageInputField = memo(
  forwardRef<MessageInputFieldRef, MessageInputFieldProps>(
    (
      {
        isNewSession,
        isSmallScreen,
        viewportHeight,
        isReadOnly,
        placeholder,
        autoFocus,
        onValueChange,
        onUserInput,
        onKeyDown,
        onPaste,
      },
      ref
    ) => {
      const { messageInput, setMessageInput, clearDraft } = useMessageInput('', { isNewSession })
      const inputRef = useRef<HTMLTextAreaElement | null>(null)
      const messageInputRef = useRef(messageInput)
      messageInputRef.current = messageInput

      useEffect(() => {
        onValueChange(messageInput)
      }, [messageInput, onValueChange])

      useImperativeHandle(
        ref,
        () => ({
          getValue: () => messageInputRef.current,
          setValue: (val) => setMessageInput(val),
          clearDraft: () => clearDraft(),
          getElement: () => inputRef.current,
        }),
        [setMessageInput, clearDraft]
      )

      const onChange = useCallback(
        (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          setMessageInput(event.target.value)
          onUserInput?.()
        },
        [setMessageInput, onUserInput]
      )

      // --- Skill slash-command picker ---
      const enabledSkills = useEnabledSkills()
      const [slashActiveIndex, setSlashActiveIndex] = useState(0)
      const slashQuery = getSlashQuery(messageInput)
      const slashMatches = useMemo(
        () =>
          slashQuery === null
            ? []
            : enabledSkills
                .filter((s) => s.name.includes(slashQuery) || s.description.toLowerCase().includes(slashQuery))
                .slice(0, 8),
        [slashQuery, enabledSkills]
      )
      const slashOpen = slashMatches.length > 0
      // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlight when the result set changes
      useEffect(() => {
        setSlashActiveIndex(0)
      }, [slashQuery])

      const selectSlashSkill = useCallback(
        (skill: { name: string }) => {
          setMessageInput(`/${skill.name} `)
          onUserInput?.()
          inputRef.current?.focus()
        },
        [setMessageInput, onUserInput]
      )

      const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (slashOpen) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSlashActiveIndex((i) => (i + 1) % slashMatches.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSlashActiveIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length)
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              selectSlashSkill(slashMatches[slashActiveIndex])
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMessageInput('')
              return
            }
          }
          onKeyDown(event)
        },
        [slashOpen, slashMatches, slashActiveIndex, selectSlashSkill, onKeyDown, setMessageInput]
      )

      return (
        <Box className="relative flex-1">
          {slashOpen && (
            <SkillSlashMenu
              skills={slashMatches}
              activeIndex={slashActiveIndex}
              onSelect={selectSlashSkill}
              onHover={setSlashActiveIndex}
            />
          )}
          <Textarea
            unstyled={true}
            styles={{ input: { fontSize: 14 } }}
            classNames={{
              root: 'flex-1',
              wrapper: 'flex-1',
              input:
                'block w-full outline-none border-none px-2 py-1 resize-none bg-transparent text-workspaice-tint-primary leading-6',
            }}
            size="sm"
            id={dom.messageInputID}
            ref={inputRef}
            placeholder={placeholder || ''}
            bg="transparent"
            autosize={true}
            minRows={2}
            maxRows={Math.max(4, Math.floor(viewportHeight / 100))}
            value={messageInput}
            autoFocus={autoFocus}
            readOnly={isReadOnly}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            data-testid="message-input"
          />
        </Box>
      )
    }
  )
)
