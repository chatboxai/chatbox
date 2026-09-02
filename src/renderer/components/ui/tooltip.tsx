import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

type AppTooltipPosition =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'right'
  | 'right-start'
  | 'right-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'

interface AppTooltipProps {
  children: React.ReactElement
  label: React.ReactNode
  className?: string
  color?: string
  disabled?: boolean
  maw?: React.CSSProperties['maxWidth']
  multiline?: boolean
  offset?: number
  onOpenChange?: (opened: boolean) => void
  openOnTouch?: boolean
  openDelay?: number
  opened?: boolean
  position?: AppTooltipPosition
  styles?: {
    arrow?: React.CSSProperties
    tooltip?: React.CSSProperties
  }
  w?: React.CSSProperties['width']
  withArrow?: boolean
  zIndex?: number
}

function getTooltipPlacement(position: AppTooltipPosition): {
  align: 'start' | 'center' | 'end'
  side: 'top' | 'right' | 'bottom' | 'left'
} {
  const [side, alignment] = position.split('-') as ['top' | 'right' | 'bottom' | 'left', 'start' | 'end' | undefined]
  return { side, align: alignment ?? 'center' }
}

function AppTooltip({
  children,
  label,
  className,
  color,
  disabled = false,
  maw,
  multiline = false,
  offset = 4,
  onOpenChange,
  openOnTouch = false,
  openDelay,
  opened,
  position = 'top',
  styles,
  w,
  withArrow = false,
  zIndex,
}: AppTooltipProps) {
  const [touchOpened, setTouchOpened] = React.useState(false)
  const touchPointerDownRef = React.useRef(false)
  const touchPreviousOpenedRef = React.useRef(false)

  // While disabled the tooltip unmounts but this wrapper stays; drop any touch
  // state so re-enabling cannot pop the tooltip open without an interaction.
  React.useEffect(() => {
    if (disabled) {
      setTouchOpened(false)
      touchPointerDownRef.current = false
    }
  }, [disabled])

  if (disabled) {
    return children
  }

  const { side, align } = getTooltipPlacement(position)
  const colorStyle =
    color === 'chatbox-error'
      ? {
          backgroundColor: 'var(--chatbox-background-error-primary)',
          color: 'var(--chatbox-tint-white)',
        }
      : color === 'dark'
        ? {
            backgroundColor: 'var(--chatbox-tint-black)',
            color: 'var(--chatbox-tint-white)',
          }
        : undefined
  const contentStyle: React.CSSProperties = {
    ...colorStyle,
    ...styles?.tooltip,
    width: w,
    maxWidth: maw,
    zIndex,
  }
  const trigger =
    React.isValidElement<{ disabled?: boolean }>(children) && children.props.disabled ? (
      <span className="inline-flex">{children}</span>
    ) : (
      children
    )
  const customArrowFill = styles?.arrow?.backgroundColor ?? styles?.arrow?.background
  const arrowFill =
    typeof customArrowFill === 'number'
      ? String(customArrowFill)
      : (customArrowFill ?? colorStyle?.backgroundColor ?? 'var(--primary)')
  const resolvedOpened = opened ?? (openOnTouch ? touchOpened : undefined)
  const handleOpenChange = (nextOpened: boolean) => {
    if (opened === undefined && openOnTouch) {
      setTouchOpened(nextOpened)
    }
    onOpenChange?.(nextOpened)
  }

  return (
    <Tooltip delayDuration={openDelay} open={resolvedOpened} onOpenChange={handleOpenChange}>
      <TooltipTrigger
        asChild
        onPointerDown={(event) => {
          if (!openOnTouch) {
            return
          }
          // Pens tap like fingers: quick stylus taps never satisfy the hover
          // open delay either, so they need the same tap-to-toggle path.
          if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
            touchPointerDownRef.current = false
            return
          }
          touchPointerDownRef.current = true
          touchPreviousOpenedRef.current = Boolean(resolvedOpened)
          // Radix composes consumer handlers before its own and skips its internal
          // close/focus handling when the consumer prevents the event.
          event.preventDefault()
        }}
        onPointerCancel={() => {
          touchPointerDownRef.current = false
        }}
        onPointerUp={() => {
          if (!touchPointerDownRef.current) {
            return
          }
          // The tap's click (if any) is dispatched right after pointerup; clear
          // afterwards so an aborted gesture (released off the trigger) cannot
          // arm a later pointerdown-less click from assistive tech/automation.
          window.setTimeout(() => {
            touchPointerDownRef.current = false
          }, 0)
        }}
        onKeyDown={() => {
          touchPointerDownRef.current = false
        }}
        onClick={(event) => {
          if (!touchPointerDownRef.current) {
            return
          }
          touchPointerDownRef.current = false
          event.preventDefault()
          handleOpenChange(!touchPreviousOpenedRef.current)
        }}
      >
        {trigger}
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={offset}
        className={cn(multiline && 'whitespace-normal', className)}
        style={contentStyle}
      >
        {label}
        {withArrow && (
          <TooltipPrimitive.Arrow
            className="fill-primary"
            style={{
              ...styles?.arrow,
              fill: arrowFill,
            }}
          />
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export { AppTooltip, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
