import { atom, useAtomValue } from 'jotai'
import { debounce } from 'lodash'
import platform from '@/platform'

export const isFullscreenAtom = atom(false)

isFullscreenAtom.onMount = (set) => {
  const check = async () => {
    set(await platform.isFullscreen())
  }
  void check()
  const handleResize = debounce(check, 250)
  window.addEventListener('resize', handleResize)
  return () => {
    window.removeEventListener('resize', handleResize)
    handleResize.cancel?.()
  }
}

export const platformTypeAtom = atom('')

platformTypeAtom.onMount = (set) => {
  platform.getPlatform().then((p) => {
    set(p)
  })
}

const needRoomForWinControlsAtom = atom((get) => {
  const isFullscreen = get(isFullscreenAtom)
  const platformType = get(platformTypeAtom)

  return {
    needRoomForMacWindowControls: platformType === 'darwin' && !isFullscreen,
    needRoomForWindowsWindowControls: platformType === 'win32' || platformType === 'linux',
  }
})

const useNeedRoomForWinControls = () => {
  return useAtomValue(needRoomForWinControlsAtom)
}

export default useNeedRoomForWinControls
