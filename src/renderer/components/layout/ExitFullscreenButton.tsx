import { debounce } from 'lodash'
import { useEffect, useState } from 'react'
import platform from '@/platform'

/**
 * 为 Windows 桌面用户准备的全屏退出按钮。一些用户会按 F11 强制进入全屏，但是却不知道怎么退出去。
 * @returns
 */
export default function ExitFullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const checkFullscreen = async () => {
      const isFullscreen = await platform.isFullscreen()
      setIsFullscreen(isFullscreen)
    }
    // 初始检查
    void checkFullscreen()
    // 监听窗口变化事件
    const handleResize = debounce(() => {
      void checkFullscreen()
    }, 1 * 1000)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])
  const onClick = () => {
    platform.setFullscreen(false)
  }
  if (!isFullscreen) {
    return null
  }
  return (
    <div
      className="fixed top-0 left-1/2 -translate-x-1/2 w-full h-3 cursor-move hover:bg-gray-400/20"
      onClick={onClick}
    ></div>
  )
}
