import { Menu, type MenuItemProps, type MenuProps, Stack, Text, useMantineTheme } from '@mantine/core'
import { IconCheck, type IconProps } from '@tabler/icons-react'
import { type FC, type MouseEventHandler, type ReactElement, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { AccessibleDrawerContent } from './common/AccessibleDrawerContent'
import { Divider } from './common/Divider'
import { ScalableIcon } from './common/ScalableIcon'

export type ActionMenuItemProps =
  | {
      divider?: false
      text: string
      icon?: React.ElementType<IconProps>
      color?: MenuItemProps['color']
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

export type ActionMenuProps = {
  children: ReactElement
  items: ActionMenuItemProps[]
  title?: string
  type?: 'desktop' | 'mobile' | 'auto'
} & MenuProps

export const ActionMenu: FC<ActionMenuProps> = ({ type = 'auto', ...props }) => {
  const isSmallScreen = useIsSmallScreen()

  if ((isSmallScreen && type === 'auto') || type === 'mobile') {
    return <MobileActionMenu {...props} />
  }

  return <DesktopActionMenu {...props} />
}

const DesktopActionMenu: FC<ActionMenuProps> = ({
  children,
  items,
  title,
  position = 'bottom-start',
  ...menuProps
}) => {
  const theme = useMantineTheme()

  return (
    <Menu position={position} {...menuProps}>
      <Menu.Target>{children}</Menu.Target>

      <Menu.Dropdown miw={150} onClick={(e) => e.stopPropagation()}>
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
              onClick={item.onClick}
            />
          ) : (
            <Menu.Item
              key={`${item.text}${index}`}
              leftSection={item.icon ? <ScalableIcon icon={item.icon} size={14} /> : undefined}
              color={item.color || 'chatbox-primary'}
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

const MobileActionMenu: FC<ActionMenuProps> = ({ children, items, title }) => {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()

  const handleItemClick = (onClick?: MouseEventHandler<HTMLButtonElement>) => {
    return (e: React.MouseEvent<HTMLButtonElement>) => {
      if (onClick) {
        onClick(e)
      }
      setOpen(false)
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} noBodyStyles>
      <Drawer.Trigger asChild>{children}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
        <AccessibleDrawerContent
          accessibleTitle={title || t('Actions')}
          accessibleDescription={t('Choose one of the available actions for this menu.')}
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
                    onClick={handleItemClick(item.onClick)}
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
        </AccessibleDrawerContent>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

const MobileDoubleCheckMenuItem: FC<{
  item: Extract<ActionMenuItemProps, { divider?: false }>
  onConfirm?: (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ item, onConfirm }) => {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { t } = useTranslation()

  if (!item.doubleCheck) return null

  const doubleCheckConfig = item.doubleCheck === true ? {} : item.doubleCheck
  const doubleCheckText = doubleCheckConfig.text ?? t('Confirm?')
  const doubleCheckColor = doubleCheckConfig.color ?? item.color ?? 'chatbox-error'

  return (
    <Drawer.NestedRoot noBodyStyles open={confirmOpen} onOpenChange={setConfirmOpen}>
      <Drawer.Trigger asChild>
        <button className="border-0 bg-transparent p-2.5">
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
        <AccessibleDrawerContent
          accessibleTitle={doubleCheckText}
          accessibleDescription={t('Confirm this action or cancel to go back.')}
          className="flex flex-col h-fit fixed bottom-0 left-0 right-0 outline-none"
        >
          <div className="bg-chatbox-background-primary rounded-t-lg">
            <Drawer.Handle />
            <Stack className="px-2" gap={0}>
              <Drawer.Close asChild>
                <button
                  onClick={(e) => {
                    onConfirm?.(e)
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
        </AccessibleDrawerContent>
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
  ...menuItemProps
}: {
  timeout?: number
  text: string
  icon?: React.ElementType<IconProps>
  onClick?: MouseEventHandler<HTMLButtonElement>
  doubleCheckText?: string
  doubleCheckIcon?: React.ElementType<IconProps>
  doubleCheckColor?: MenuItemProps['color']
} & MenuItemProps) => {
  const { t } = useTranslation()
  const [showConfirm, setShowConfirm] = useState(false)
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
      leftSection={<ScalableIcon icon={doubleCheckIcon || IconCheck} size={14} />}
      onClick={onClick}
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
