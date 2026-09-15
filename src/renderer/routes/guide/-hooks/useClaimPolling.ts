import { accountLicenseFromApi, selectAccountLicense } from '@shared/utils/account-license'
import { settingsStore } from '@/stores/settingsStore'
/**
 * useClaimPolling — polls the backend for the user's free-plan license to appear.
 *
 * Lifecycle is bound to the consuming component (typically ClaimWaitingCard):
 * unmount → poll loop, visibility listener and pending fetch are all torn down.
 */

import { useEffect, useRef } from 'react'
import { getUserProfile, listLicensesByUser, type UserLicense } from '@/packages/remote'

const POLL_INTERVAL_MS = 10_000
const TIMEOUT_MS = 10 * 60 * 1000

interface UseClaimPollingArgs {
  enabled: boolean
  onClaimed: (license: UserLicense, email: string) => void
  onTimeout: () => void
}

export function useClaimPolling({ enabled, onClaimed, onTimeout }: UseClaimPollingArgs) {
  const onClaimedRef = useRef(onClaimed)
  const onTimeoutRef = useRef(onTimeout)
  onClaimedRef.current = onClaimed
  onTimeoutRef.current = onTimeout

  useEffect(() => {
    if (!enabled) return

    const startedAt = Date.now()
    let stopped = false
    let timedOut = false

    const poll = async () => {
      if (stopped) return
      if (Date.now() - startedAt > TIMEOUT_MS) {
        if (!timedOut) {
          timedOut = true
          stopped = true
          onTimeoutRef.current()
        }
        return
      }
      try {
        const licenses = await listLicensesByUser()
        if (stopped) return
        if (licenses.length > 0) {
          const profile = await getUserProfile()
          if (stopped) return
          const selection = selectAccountLicense(
            licenses.map(accountLicenseFromApi),
            settingsStore.getState(),
            profile.email,
            true
          )
          if (!selection.selected) return
          stopped = true
          onClaimedRef.current(licenses.find((license) => license.key === selection.selected?.key)!, profile.email)
        }
      } catch (err) {
        console.warn('[claim-polling] poll failed:', err)
      }
    }

    const intervalId = window.setInterval(() => void poll(), POLL_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    void poll()

    return () => {
      stopped = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled])
}
