import { Button, type ButtonProps, Flex, Popover, type PopoverProps, Stack, Text } from '@mantine/core'
import { t } from 'i18next'
import { cloneElement, type FC, isValidElement, type PropsWithChildren, type ReactElement, useState } from 'react'

export type PopoverConfirmProps = PropsWithChildren<
  PopoverProps & {
    title: string
    onConfirm?: () => void
    confirmButtonText?: string
    confirmButtonColor?: ButtonProps['color']
  }
>

export const PopoverConfirm: FC<PopoverConfirmProps> = ({
  children,
  title,
  onConfirm,
  confirmButtonText,
  confirmButtonColor,
  ...others
}) => {
  const [opened, setOpened] = useState(false)

  const handleConfirm = () => {
    setOpened(false)
    if (onConfirm) onConfirm()
  }

  // cloneElement 保证传递事件，不破坏原子元素的所有 CSS
  let target = children
  if (isValidElement(children)) {
    const childElement = children as ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
    target = cloneElement(childElement, {
      onClick: (e: React.MouseEvent) => {
        if (childElement.props.onClick) childElement.props.onClick(e)
        setOpened(true)
      },
    })
  } else {
    // 不是 react element，警告
    console.warn('Popconfirm 的 children 需要是一个 React 元素')
  }

  return (
    <Popover position="bottom" withArrow withinPortal {...others} opened={opened} onChange={setOpened}>
      <Popover.Target>{target}</Popover.Target>
      <Popover.Dropdown>
        <Stack>
          <Text>{title}</Text>
          <Flex justify="flex-end">
            <Button color={confirmButtonColor} onClick={handleConfirm}>
              {confirmButtonText || t('Confirm')}
            </Button>
          </Flex>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )

  // const [opened, setOpened] = useState(false)
  // return (
  //   <Popover withArrow {...others} opened={opened} onChange={setOpened}>
  //     <Popover.Target>
  //       <Button onClick={() => setOpened((o) => !o)}>Toggle popover</Button>
  //     </Popover.Target>
  //     <Popover.Dropdown>
  //       <Stack>
  //         <Text>{text}</Text>
  //         <Flex justify="flex-end">
  //           <Button color={confirmButtonColor} onClick={() => setOpened(false)}>
  //             {confirmButtonText || t('Confirm')}
  //           </Button>
  //         </Flex>
  //       </Stack>
  //     </Popover.Dropdown>
  //   </Popover>
  // )
}

export default PopoverConfirm
