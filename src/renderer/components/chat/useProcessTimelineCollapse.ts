import type { SessionMode } from '@chatbox/core/session/mode-policy'
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'

export function useProcessTimelineCollapse(
  sessionMode: SessionMode | undefined,
  generating: boolean | undefined
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [collapsed, setCollapsed] = useState(sessionMode === 'work')

  // The summary is hidden during generation. Reset it at the start of each run
  // so it first appears collapsed when the Work Mode reply completes.
  useEffect(() => {
    if (sessionMode === 'work' && generating) {
      setCollapsed(true)
    }
  }, [generating, sessionMode])

  return [collapsed, setCollapsed]
}
