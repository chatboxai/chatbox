import { useState, useEffect, useRef } from 'react'
import * as remote from '../packages/remote'
import platform from '../packages/platform'

export default function useVersion() {
    const [version, _setVersion] = useState('')
    const [needCheckUpdate, setNeedCheckUpdate] = useState(false)
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
                // setNeedCheckUpdate(needUpdate)
            } catch (e) {
                console.log(e)
                // setNeedCheckUpdate(true)
            }
        }
        handler()
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
        needCheckUpdate,
    }
}
