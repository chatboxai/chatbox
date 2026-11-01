import { ActionIcon, type ActionIconProps } from '@mantine/core'
import type { IconProps } from '@tabler/icons-react'
import { type ComponentPropsWithoutRef, type ElementType, forwardRef, type RefAttributes } from 'react'
import { ScalableIcon } from './ScalableIcon'

/**
 * Icon sizes: `nav` for navigation and toolbars, `inline` for in-row and in-message actions,
 * `touch` for the 44px targets of small-screen headers.
 */
export const ICON_SIZE = {
  nav: 18,
  inline: 16,
  touch: 22,
} as const

export const ICON_STROKE_WIDTH = 1.8

const BUTTON_SIZE = {
  sm: 28,
  md: 32,
  lg: 44,
} as const

export type IconButtonProps = Omit<ActionIconProps, 'size' | 'children'> &
  Omit<ComponentPropsWithoutRef<'button'>, 'color' | 'style' | 'children' | 'aria-label'> & {
    'aria-label'?: string | null
    icon: ElementType<IconProps & RefAttributes<SVGSVGElement>>
    /** Hit area: `sm` = 28px, `md` = 32px, `lg` = 44px touch target. */
    size?: keyof typeof BUTTON_SIZE
    iconSize?: number
  }

/** Subtle square icon button shared by headers, toolbars and the sidebar. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      size = 'sm',
      iconSize = ICON_SIZE.nav,
      variant = 'subtle',
      color = 'chatbox-secondary',
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => (
    <ActionIcon
      ref={ref}
      variant={variant}
      color={color}
      size={BUTTON_SIZE[size]}
      radius="md"
      aria-label={ariaLabel ?? undefined}
      {...props}
    >
      <ScalableIcon icon={icon} size={iconSize} strokeWidth={ICON_STROKE_WIDTH} />
    </ActionIcon>
  )
)

IconButton.displayName = 'IconButton'
