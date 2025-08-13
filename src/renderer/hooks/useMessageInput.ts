import { useAtomValue } from 'jotai'
import { debounce } from 'lodash'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { currentSessionIdAtom } from '@/stores/atoms/sessionAtoms'

const DEFAULT_OPTIONS = { saveDraft: true, timeout: 300, isNewSession: false }
type Options = typeof DEFAULT_OPTIONS
export function useMessageInput(initialMessage = '', _options: Partial<Options> = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ..._options,
  }
  const [messageInput, _setMessageInput] = useState<string>(initialMessage)
  const currentSessionId = useAtomValue(currentSessionIdAtom)

  const draftRef = useRef<string>(initialMessage)

  const draftStorageKey = useMemo(() => {
    return options.isNewSession ? 'new-chat' : `draft-${currentSessionId}`
  }, [currentSessionId, options.isNewSession])

  const restoreDraft = useCallback(() => {
    const draft = localStorage.getItem(draftStorageKey)
    if (!draft) return
    _setMessageInput(draft)
    draftRef.current = draft
  }, [draftStorageKey])

  const _debouncedStoreDraft = useMemo(
    () =>
      debounce((message: string) => {
        localStorage.setItem(draftStorageKey, message)
      }, options.timeout),
    [draftStorageKey, options.timeout]
  )

  const storeDraft = useCallback(
    (newMessage: SetStateAction<string>) => {
      let message: string
      if (typeof newMessage === 'string') {
        message = newMessage
      } else {
        // if setMessageInput is called with callback function
        message = newMessage(draftRef.current)
      }

      // should update draftRef outside _debouncedStoreDraft
      draftRef.current = message
      _debouncedStoreDraft(message)
    },
    [_debouncedStoreDraft]
  )

  const setMessageInput: Dispatch<SetStateAction<string>> = useCallback(
    (newMessage) => {
      _setMessageInput(newMessage)
      storeDraft(newMessage)
    },
    [storeDraft]
  )

  const clearDraft = useCallback(() => {
    _setMessageInput('')
    draftRef.current = ''
    localStorage.removeItem(draftStorageKey)
    _debouncedStoreDraft.cancel()
  }, [draftStorageKey, _debouncedStoreDraft])

  useEffect(() => {
    if (options.saveDraft) {
      restoreDraft()
    }
  }, [restoreDraft, options.saveDraft])

  return {
    messageInput,
    setMessageInput,
    clearDraft,
    storeDraft,
    restoreDraft,
  }
}
