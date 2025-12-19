import { Drawer as MantineDrawer, Modal as MantineModal } from '@mantine/core'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useId } from 'react'

// Global overlay stack management
export const overlayStackAtom = atom<string[]>([])

// Custom Hook to manage any overlay component
export const useOverlayManager = (opened?: boolean) => {
  const id = useId()
  const stack = useAtomValue(overlayStackAtom)
  const setStack = useSetAtom(overlayStackAtom)

  useEffect(() => {
    if (opened) {
      setStack((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } else {
      setStack((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : prev))
    }

    return () => setStack((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : prev))
  }, [opened, id, setStack])

  // Only allow ESC to close when the current layer is the topmost
  return stack[stack.length - 1] === id
}

export function withOverlayManager<P extends { opened?: boolean; closeOnEscape?: boolean }>(
  Component: React.ComponentType<P>,
  displayName?: string
) {
  const WrappedComponent = (props: P) => {
    const isTopOverlay = useOverlayManager(props.opened)

    return <Component closeOnEscape={isTopOverlay} {...props} />
  }

  WrappedComponent.displayName = displayName || `withOverlayManager(${Component.displayName})`
  return WrappedComponent
}

export const Modal = withOverlayManager(MantineModal, 'Modal')
export const Drawer = withOverlayManager(MantineDrawer, 'Drawer')
