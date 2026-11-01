import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * - `applied`: the value was handed on; the field shows the stored value once it updates.
 * - `unchanged`: the value equals the stored one (possibly after normalizing, such as trimming or
 *   `1.0` → `1`); the field shows the stored value when editing ends.
 * - `rejected`: not a valid value; the field shows the stored value when editing ends.
 */
export type FieldDraftResult = 'applied' | 'unchanged' | 'rejected'

/**
 * Draft of a settings field that applies on its own schedule rather than per keystroke. A typed
 * draft is applied after `delayMs` without typing when given, and on `flush` (blur, Enter) or when
 * the field unmounts — closing a panel or leaving a page removes the field without a blur event,
 * so unmounting is the one point every exit path goes through.
 *
 * While the field is being edited it keeps the typed text even if the stored value changes, so a
 * value normalized on save does not rewrite what the user is typing; when editing ends it shows
 * the stored value.
 */
export function useFieldDraft<T>(committed: T, apply: (draft: T) => FieldDraftResult, delayMs?: number) {
  const [draft, setDraftState] = useState(committed)
  const latest = useRef(committed)
  // Typed text that has not been applied yet.
  const pending = useRef(false)
  // The field has been typed in since editing last ended.
  const editing = useRef(false)
  // The stored value when editing started, and whether an apply left the draft out of sync with it.
  const committedAtEditStart = useRef(committed)
  const resyncWhenDone = useRef(false)
  const committedRef = useRef(committed)
  committedRef.current = committed
  const applyRef = useRef(apply)
  applyRef.current = apply
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const showCommitted = useCallback(() => {
    latest.current = committedRef.current
    setDraftState(committedRef.current)
  }, [])

  useEffect(() => {
    if (!editing.current) showCommitted()
  }, [committed, showCommitted])

  const applyPending = useCallback((): FieldDraftResult | undefined => {
    clearTimeout(timer.current)
    if (!pending.current) return undefined
    pending.current = false
    const result = applyRef.current(latest.current)
    resyncWhenDone.current = result !== 'applied'
    return result
  }, [])

  const flush = useCallback(() => {
    const result = applyPending()
    if (!editing.current) return
    editing.current = false
    const resync = resyncWhenDone.current
    resyncWhenDone.current = false
    // A value applied just now shows once the stored value updates; showing the stored value
    // before then would flash the previous one.
    if (result === 'applied') return
    if (resync || committedRef.current !== committedAtEditStart.current) showCommitted()
  }, [applyPending, showCommitted])

  const setDraft = useCallback(
    (next: T) => {
      if (!editing.current) committedAtEditStart.current = committedRef.current
      pending.current = true
      editing.current = true
      latest.current = next
      setDraftState(next)
      if (delayMs !== undefined) {
        clearTimeout(timer.current)
        timer.current = setTimeout(applyPending, delayMs)
      }
    },
    [delayMs, applyPending]
  )

  useEffect(() => () => void applyPending(), [applyPending])

  return { draft, setDraft, flush }
}
