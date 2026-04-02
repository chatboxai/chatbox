import type * as React from 'react'
import { useLayoutEffect, useRef } from 'react'
import { Drawer } from 'vaul'
import { handoffFocusToOverlay } from './overlay-focus'

type AccessibleDrawerContentProps = React.ComponentPropsWithoutRef<typeof Drawer.Content> & {
  accessibleTitle: React.ReactNode
  accessibleDescription: React.ReactNode
}

export function AccessibleDrawerContent({
  accessibleTitle,
  accessibleDescription,
  children,
  ...props
}: AccessibleDrawerContentProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    handoffFocusToOverlay(contentRef.current)
  }, [])

  return (
    <Drawer.Content {...props} ref={contentRef} tabIndex={props.tabIndex ?? -1}>
      <Drawer.Title className="sr-only">{accessibleTitle}</Drawer.Title>
      <Drawer.Description className="sr-only">{accessibleDescription}</Drawer.Description>
      {children}
    </Drawer.Content>
  )
}
