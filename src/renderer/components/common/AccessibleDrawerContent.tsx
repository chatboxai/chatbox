import type * as React from 'react'
import { Drawer } from 'vaul'

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
  return (
    <Drawer.Content {...props}>
      <Drawer.Title className="sr-only">{accessibleTitle}</Drawer.Title>
      <Drawer.Description className="sr-only">{accessibleDescription}</Drawer.Description>
      {children}
    </Drawer.Content>
  )
}
