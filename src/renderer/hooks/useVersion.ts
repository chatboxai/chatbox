import { compareVersions, validate } from 'compare-versions'
import dayjs from 'dayjs'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { remoteConfigAtom } from '@/stores/atoms'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import * as remote from '../packages/remote'
import platform from '../platform'

function getInitialTime() {
  let initialTime = parseInt(localStorage.getItem('initial-time') || '')
  if (!initialTime) {
    initialTime = Date.now()
    localStorage.setItem('initial-time', `${initialTime}`)
  }

  return initialTime
}

export function isFirstDay(): boolean {
  const initialTime = getInitialTime()
  const today = dayjs()
  const installDay = dayjs(initialTime)

  // Compare only the date part (year, month, day) in user's local timezone
  // This ensures the comparison is based on the user's current timezone,
  // which is more intuitive for the user experience
  return today.isSame(installDay, 'day')
}

export default function useVersion() {
  const [version, _setVersion] = useState('')
  const [needCheckUpdate, setNeedCheckUpdate] = useState(false)
  const remoteConfig = useAtomValue(remoteConfigAtom)
  const isExceeded = useMemo(
    () => {
      const currentVersion = version?.trim()
      const latestVersion = remoteConfig.current_version?.trim()
      const canCompare =
        CHATBOX_BUILD_PLATFORM === 'ios' &&
        Date.now() - getInitialTime() < 24 * 3600 * 1000 &&
        !!currentVersion &&
        !!latestVersion &&
        validate(currentVersion) &&
        validate(latestVersion)

      return canCompare ? compareVersions(currentVersion, latestVersion) === 1 : false
    },
    [version, remoteConfig]
  )
  const updateCheckTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    const handler = async () => {
      const config = await platform.getConfig()
      const settings = await platform.getSettings()
      const version = await platform.getVersion()
      _setVersion(version)
      try {
        const os = await platform.getPlatform()
        const needUpdate = await remote.checkNeedUpdate(version, os, config, settings)
        setNeedCheckUpdate(needUpdate)
      } catch (e) {
        console.log(e)
      }
    }
    void handler()
    updateCheckTimer.current = setInterval(handler, 2 * 60 * 60 * 1000)
    return () => {
      if (updateCheckTimer.current) {
        clearInterval(updateCheckTimer.current)
        updateCheckTimer.current = undefined
      }
    }
  }, [])

  return {
    version,
    isExceeded,
    needCheckUpdate,
  }
}
