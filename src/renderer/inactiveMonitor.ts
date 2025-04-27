import { useEffect, useRef } from 'react'
import platform from '@/packages/platform'
import * as sessionActions from '@/stores/sessionActions'
import { throttle } from 'lodash'

export function useInactivityMonitor() {
    const lastExecuted = useRef(0)

    useEffect(() => {
        const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'touchmove']

        const checkInactivity = throttle(async () => {
            const now = Date.now()

            // Enforce 30-second cooldown
            if (now - lastExecuted.current < 30000) {
                return
            }

            platform.getLastActiveTime().then((lastActive) => {
                const lastActiveDuration = Date.now() - lastActive
                const oneHour = 3_600_000
                if (lastActiveDuration <= oneHour) return
                sessionActions.reuseInactiveSession()
            })
            lastExecuted.current = Date.now()
        }, 5000)

        // Immediate check on first load
        checkInactivity()

        const debounce = (fn: Function, delay: number) => {
            let timeoutId: number
            return (...args: any[]) => {
                window.clearTimeout(timeoutId)
                timeoutId = window.setTimeout(() => fn(...args), delay)
            }
        }

        const updateActivity = throttle(async () => {
            await platform.setLastActiveTime(Date.now())
        }, 10)

        const handleActivity = () => {
            updateActivity()
            checkInactivity()
        }

        activityEvents.forEach((event) => {
            window.addEventListener(event, handleActivity, { passive: true })
        })

        return () => {
            activityEvents.forEach((event) => {
                window.removeEventListener(event, handleActivity)
            })
        }
    }, [])
}
