import { useEffect, useRef, useState } from 'react'

/** Owns a one-shot undo callback only after the corresponding creation succeeds. */
export function useThreadCreation({
  sessionId,
  create,
  onError,
}: {
  sessionId: string
  create?: () => Promise<(() => Promise<boolean>) | undefined>
  onError(error: unknown): void
}) {
  const [pending, setPending] = useState(false)
  const [undo, setUndo] = useState<{ sessionId: string; run: () => Promise<boolean> }>()
  const activeSession = useRef(sessionId)
  const generation = useRef(0)
  if (activeSession.current !== sessionId) {
    activeSession.current = sessionId
    generation.current += 1
  }
  const busy = useRef(false)
  const undoRef = useRef(undo)
  undoRef.current = undo
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    undoRef.current = undefined
    setUndo(undefined)
  }, [sessionId])
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => {
      undoRef.current = undefined
      setUndo(undefined)
    }, 5000)
    return () => clearTimeout(timer)
  }, [undo])

  const dismissUndo = () => {
    generation.current += 1
    undoRef.current = undefined
    setUndo(undefined)
  }
  const start = async () => {
    if (!create || busy.current) return
    busy.current = true
    setPending(true)
    dismissUndo()
    const startedGeneration = generation.current
    try {
      const run = await create()
      if (run && mounted.current && generation.current === startedGeneration) setUndo({ sessionId, run })
    } catch (error) {
      if (mounted.current) onError(error)
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  const rollback = async () => {
    const target = undoRef.current
    if (busy.current || !target || target.sessionId !== sessionId) return
    busy.current = true
    dismissUndo()
    setPending(true)
    try {
      await target.run()
    } catch (error) {
      if (mounted.current) onError(error)
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  return { pending, canRollback: undo?.sessionId === sessionId, start, rollback, dismissUndo }
}
