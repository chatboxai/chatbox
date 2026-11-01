import { Menu, type MenuItemProps, type MenuProps, Popover, Stack, Text, useMantineTheme } from '@mantine/core'
import { IconCheck, type IconProps } from '@tabler/icons-react'
import { type FC, type MouseEventHandler, type ReactElement, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { Divider } from './common/Divider'
import { ScalableIcon } from './common/ScalableIcon'

export type ActionMenuItemProps =
  | {
      divider?: false
      text: string
      testId?: string
      confirmTestId?: string
      confirmPanelTestId?: string
      icon?: React.ElementType<IconProps>
      color?: MenuItemProps['color']
      disabled?: boolean
      onClick?: MouseEventHandler<HTMLButtonElement>
      doubleCheck?:
        | boolean
        | {
            text?: string // 二次确认的文字，默认 t('Confirm?')
            icon?: React.ElementType<IconProps>
            color?: MenuItemProps['color']
            timeout?: number // 二次确认的超时时间，默认 5000 毫秒
          } // 点击时需要二次确认
    }
  | {
      divider: true
    }
type ActionMenuCommandItem = Extract<ActionMenuItemProps, { divider?: false }>
type ActionMenuDoubleCheckItem = ActionMenuCommandItem & {
  doubleCheck: Exclude<NonNullable<ActionMenuCommandItem['doubleCheck']>, false>
}

function hasDoubleCheck(item: ActionMenuCommandItem): item is ActionMenuDoubleCheckItem {
  return Boolean(item.doubleCheck)
}

export type ActionMenuProps = {
  children: ReactElement
  items: ActionMenuItemProps[]
  title?: string
  contentTestId?: string
  type?: 'desktop' | 'mobile' | 'contextual' | 'auto'
  trigger?: 'click' | 'manual'
} & Omit<MenuProps, 'trigger'>

export const ActionMenu: FC<ActionMenuProps> = ({ type = 'auto', ...props }) => {
  const isSmallScreen = useIsSmallScreen()

  if (type === 'contextual') {
    return <ContextualActionMenu {...props} />
  }

  if ((isSmallScreen && type === 'auto') || type === 'mobile') {
    return <MobileActionMenu {...props} />
  }

  return <DesktopActionMenu {...props} />
}

const DesktopActionMenu: FC<ActionMenuProps> = ({
  children,
  items,
  title,
  contentTestId,
  trigger: _trigger,
  position = 'bottom-start',
  ...menuProps
}) => {
  const theme = useMantineTheme()

  return (
    <Menu position={position} {...menuProps}>
      <Menu.Target>{children}</Menu.Target>

      <Menu.Dropdown data-testid={contentTestId} miw={150} onClick={(e) => e.stopPropagation()}>
        {items.map((item, index) =>
          item.divider ? (
            <Divider key={`divider-${item.divider}-${index}`} className="my-xxs" />
          ) : item.doubleCheck ? (
            <DoubleCheckMenuItem
              key={`${item.text}${index}`}
              color={item.color ?? 'chatbox-error'}
              text={item.text}
              icon={item.icon}
              doubleCheckText={item.doubleCheck === true ? undefined : item.doubleCheck.text}
              doubleCheckIcon={item.doubleCheck === true ? undefined : item.doubleCheck.icon}
              doubleCheckColor={item.doubleCheck === true ? undefined : item.doubleCheck.color}
              disabled={item.disabled}
              testId={item.testId}
              confirmTestId={item.confirmTestId}
              onClick={item.onClick}
            />
          ) : (
            <Menu.Item
              key={`${item.text}${index}`}
              leftSection={item.icon ? <ScalableIcon icon={item.icon} size={14} /> : undefined}
              color={item.color || 'chatbox-primary'}
              disabled={item.disabled}
              data-testid={item.testId}
              style={{
                color: theme.variantColorResolver({ color: item.color || 'chatbox-primary', theme, variant: 'light' })
                  .color,
              }}
              onClick={item.onClick}
            >
              {item.text}
            </Menu.Item>
          )
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

const ContextualActionMenu: FC<ActionMenuProps> = ({
  children,
  items,
  title,
  contentTestId,
  opened,
  onChange,
  position = 'right-start',
  offset = 6,
  withinPortal = true,
  portalProps,
}) => {
  const theme = useMantineTheme()

  const handleItemClick = (onClick?: MouseEventHandler<HTMLButtonElement>) => {
    return async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      if (onClick) {
        await onClick(e)
      }
      onChange?.(false)
    }
  }

  return (
    <Popover
      opened={opened}
      onChange={onChange}
      position={position}
      offset={offset}
      withinPortal={withinPortal}
      portalProps={portalProps}
      shadow="md"
      radius="lg"
    >
      <Popover.Target>{children}</Popover.Target>
      <Popover.Dropdown
        data-testid={contentTestId}
        miw={156}
        p={4}
        className="border border-solid border-chatbox-border-primary bg-chatbox-background-primary"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <Text c="chatbox-tertiary" size="xs" className="px-2 py-1" lineClamp={1}>
            {title}
          </Text>
        )}
        <Stack gap={0}>
          {items.map((item, index) =>
            item.divider ? (
              <Divider key={`divider-${item.divider}-${index}`} className="my-xxs" />
            ) : hasDoubleCheck(item) ? (
              <ContextualDoubleCheckMenuItem
                key={`${item.text}${index}`}
                item={item}
                onConfirm={handleItemClick(item.onClick)}
              />
            ) : (
              <button
                key={`${item.text}${index}`}
                type="button"
                data-testid={item.testId}
                onClick={handleItemClick(item.onClick)}
                disabled={item.disabled}
                className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-2 text-left disabled:opacity-50"
              >
                {item.icon && <ScalableIcon icon={item.icon} size={15} />}
                <Text
                  span
                  lineClamp={1}
                  size="sm"
                  c={item.color || 'chatbox-primary'}
                  style={{
                    color: theme.variantColorResolver({
                      color: item.color || 'chatbox-primary',
                      theme,
                      variant: 'light',
                    }).color,
                  }}
                >
                  {item.text}
                </Text>
              </button>
            )
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

const ContextualDoubleCheckMenuItem: FC<{
  item: ActionMenuDoubleCheckItem
  onConfirm?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
}> = ({ item, onConfirm }) => {
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const { t } = useTranslation()
  const theme = useMantineTheme()

  const doubleCheckConfig = item.doubleCheck === true ? {} : item.doubleCheck
  const doubleCheckText = doubleCheckConfig.text ?? t('Confirm?')
  const doubleCheckIcon = doubleCheckConfig.icon ?? IconCheck
  const doubleCheckColor = doubleCheckConfig.color ?? item.color ?? 'chatbox-error'

  useEffect(() => {
    if (!showConfirm) {
      return
    }

    const tid = setTimeout(() => {
      setShowConfirm(false)
    }, doubleCheckConfig.timeout ?? 5000)

    return () => clearTimeout(tid)
  }, [doubleCheckConfig.timeout, showConfirm])

  const color = showConfirm
    ? doubleCheckColor
    : (typeof item.doubleCheck !== 'boolean' && item.doubleCheck.color) || item.color || 'chatbox-primary'
  const icon = showConfirm ? doubleCheckIcon : item.icon
  const text = showConfirm ? doubleCheckText : item.text

  return (
    <button
      type="button"
      data-testid={showConfirm ? (item.confirmTestId ?? item.testId) : item.testId}
      disabled={confirming || item.disabled}
      className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-2 text-left disabled:opacity-50"
      onClick={async (event) => {
        event.stopPropagation()
        if (!showConfirm) {
          setShowConfirm(true)
          return
        }
        if (confirmingRef.current) return
        confirmingRef.current = true
        setConfirming(true)
        try {
          await onConfirm?.(event)
        } finally {
          confirmingRef.current = false
          setConfirming(false)
          setShowConfirm(false)
        }
      }}
    >
      {icon && <ScalableIcon icon={icon} size={15} />}
      <Text
        span
        lineClamp={1}
        size="sm"
        c={color}
        style={{
          color: theme.variantColorResolver({ color, theme, variant: 'light' }).color,
        }}
      >
        {text}
      </Text>
    </button>
  )
}

const MobileActionMenu: FC<ActionMenuProps> = ({
  children,
  items,
  title,
  contentTestId,
  opened,
  onChange,
  trigger = 'click',
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = opened ?? uncontrolledOpen
  const setOpen = (nextOpen: boolean) => {
    onChange?.(nextOpen)
    if (opened === undefined) {
      setUncontrolledOpen(nextOpen)
    }
  }

  const handleItemClick = (onClick?: MouseEventHandler<HTMLButtonElement>) => {
    return async (e: React.MouseEvent<HTMLButtonElement>) => {
      if (onClick) {
        await onClick(e)
      }
      setOpen(false)
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} noBodyStyles>
      {trigger === 'manual' ? children : <Drawer.Trigger asChild>{children}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <Drawer.Content
          data-testid={contentTestId}
          className="flex flex-col h-fit fixed bottom-0 left-0 right-0 outline-none"
        >
          <div className="bg-chatbox-background-primary rounded-t-lg">
            <Drawer.Handle />
            {title && (
              <Text c="chatbox-tertiary" size="md" className="text-center mb-2">
                {title}
              </Text>
            )}
            <Stack className="px-2" gap={0}>
              {items.map((item, index) =>
                item.divider ? (
                  <Divider key={`divider-${item.divider}-${index}`} className="my-2" />
                ) : item.doubleCheck ? (
                  <MobileDoubleCheckMenuItem
                    key={`${item.text}${index}`}
                    item={item}
                    onConfirm={handleItemClick(item.onClick)}
                  />
                ) : (
                  <button
                    key={`${item.text}${index}`}
                    data-testid={item.testId}
                    onClick={handleItemClick(item.onClick)}
                    disabled={item.disabled}
                    className="border-0 bg-transparent p-2.5"
                  >
                    <Text span lineClamp={1} fw={600} c={item.color || 'chatbox-primary'}>
                      {item.text}
                    </Text>
                  </button>
                )
              )}
            </Stack>
            <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

const MobileDoubleCheckMenuItem: FC<{
  item: Extract<ActionMenuItemProps, { divider?: false }>
  onConfirm?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
}> = ({ item, onConfirm }) => {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const { t } = useTranslation()

  if (!item.doubleCheck) return null

  const doubleCheckConfig = item.doubleCheck === true ? {} : item.doubleCheck
  const doubleCheckText = doubleCheckConfig.text ?? t('Confirm?')
  const doubleCheckColor = doubleCheckConfig.color ?? item.color ?? 'chatbox-error'

  return (
    <Drawer.NestedRoot noBodyStyles open={confirmOpen} onOpenChange={setConfirmOpen}>
      <Drawer.Trigger asChild>
        <button className="border-0 bg-transparent p-2.5" disabled={item.disabled} data-testid={item.testId}>
          <Text
            span
            lineClamp={1}
            fw={600}
            c={(typeof item.doubleCheck !== 'boolean' && item.doubleCheck.color) || item.color || 'chatbox-error'}
          >
            {item.text}
          </Text>
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <Drawer.Content
          data-testid={item.confirmPanelTestId}
          className="flex flex-col h-fit fixed bottom-0 left-0 right-0 outline-none"
        >
          <div className="bg-chatbox-background-primary rounded-t-lg">
            <Drawer.Handle />
            <Stack className="px-2" gap={0}>
              <Drawer.Close asChild>
                <button
                  data-testid={item.confirmTestId ?? item.testId}
                  disabled={confirming || item.disabled}
                  onClick={async (e) => {
                    if (confirmingRef.current) return
                    confirmingRef.current = true
                    setConfirming(true)
                    try {
                      await onConfirm?.(e)
                    } finally {
                      confirmingRef.current = false
                      setConfirming(false)
                    }
                  }}
                  className="border-0 bg-transparent p-2.5"
                >
                  <Text span lineClamp={1} fw={600} c={doubleCheckColor}>
                    {doubleCheckText}
                  </Text>
                </button>
              </Drawer.Close>

              <Divider className="my-2" />

              <Drawer.Close asChild>
                <button className="border-0 bg-transparent p-2.5">
                  <Text c="chatbox-tertiary" span lineClamp={1} fw={600}>
                    {t('Cancel')}
                  </Text>
                </button>
              </Drawer.Close>

              <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
            </Stack>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.NestedRoot>
  )
}

export default ActionMenu

const DoubleCheckMenuItem = ({
  timeout = 5000,
  text,
  onClick,
  icon,
  doubleCheckText,
  doubleCheckIcon,
  doubleCheckColor,
  testId,
  confirmTestId,
  ...menuItemProps
}: {
  timeout?: number
  text: string
  icon?: React.ElementType<IconProps>
  onClick?: MouseEventHandler<HTMLButtonElement>
  doubleCheckText?: string
  doubleCheckIcon?: React.ElementType<IconProps>
  doubleCheckColor?: MenuItemProps['color']
  testId?: string
  confirmTestId?: string
} & MenuItemProps) => {
  const { t } = useTranslation()
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  useEffect(() => {
    if (showConfirm) {
      const tid = setTimeout(() => {
        setShowConfirm(false)
      }, timeout)

      return () => clearTimeout(tid)
    }
  }, [showConfirm, timeout])

  const theme = useMantineTheme()

  return !showConfirm ? (
    <Menu.Item
      closeMenuOnClick={false}
      leftSection={icon ? <ScalableIcon icon={icon} size={14} /> : undefined}
      onClick={() => setShowConfirm(true)}
      {...menuItemProps}
      data-testid={testId}
      style={{
        color: menuItemProps.color
          ? theme.variantColorResolver({ color: menuItemProps.color, theme, variant: 'light' }).color
          : undefined,
      }}
    >
      {text}
    </Menu.Item>
  ) : (
    <Menu.Item
      data-testid={confirmTestId ?? testId}
      leftSection={<ScalableIcon icon={doubleCheckIcon || IconCheck} size={14} />}
      disabled={confirming}
      onClick={async (event) => {
        if (confirmingRef.current) return
        confirmingRef.current = true
        setConfirming(true)
        try {
          await onClick?.(event)
        } finally {
          confirmingRef.current = false
          setConfirming(false)
          setShowConfirm(false)
        }
      }}
      {...menuItemProps}
      color={doubleCheckColor ?? menuItemProps.color}
      style={{
        color:
          (doubleCheckColor ?? menuItemProps.color)
            ? theme.variantColorResolver({ color: doubleCheckColor ?? menuItemProps.color, theme, variant: 'light' })
                .color
            : undefined,
      }}
    >
      {doubleCheckText ?? t('Confirm?')}
    </Menu.Item>
  )
}
