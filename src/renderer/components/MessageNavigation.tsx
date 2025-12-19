import { Box, Button, Divider, Stack } from '@mantine/core'
import { IconArrowDown, IconChevronDown, IconChevronsDown, IconChevronsUp, IconChevronUp } from '@tabler/icons-react'
import { clsx } from 'clsx'
import { type CSSProperties, type FC, memo, useCallback, useRef } from 'react'

export type MessageNavigationProps = {
  visible: boolean
  onVisibleChange?: (visible: boolean) => void
  onScrollToTop?: () => void
  onScrollToBottom?: () => void
  onScrollToPrev?: () => void
  onScrollToNext?: () => void
}

export const MessageNavigation: FC<MessageNavigationProps> = ({
  visible,
  onVisibleChange,
  onScrollToTop,
  onScrollToBottom,
  onScrollToPrev,
  onScrollToNext,
}) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    onVisibleChange?.(true)
  }, [onVisibleChange])

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onVisibleChange?.(false)
    }, 2000)
  }, [onVisibleChange])

  return (
    <div
      className={clsx(
        'absolute right-0 py-6 pl-2 bottom-0 transition-all',
        visible ? '-translate-x-3 opacity-100' : 'translate-x-1/2 opacity-0'
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Stack
        gap={6}
        p={'xxs'}
        className="rounded border border-solid border-chatbox-border-primary bg-chatbox-background-primary [&>.mantine-Divider-root]:border-chatbox-border-primary"
      >
        <MessageNavigationButton icon={<IconChevronsUp />} onClick={onScrollToTop} />
        <Divider />
        <MessageNavigationButton icon={<IconChevronUp />} onClick={onScrollToPrev} />
        <Divider />
        <MessageNavigationButton icon={<IconChevronDown />} onClick={onScrollToNext} />
        <Divider />
        <MessageNavigationButton icon={<IconChevronsDown />} onClick={onScrollToBottom} />
      </Stack>
    </div>
  )
}

export default memo(MessageNavigation)

const MessageNavigationButton = ({ icon, ...others }: { icon: React.ReactElement; onClick?: () => void }) => {
  const iconSize = 16
  return (
    <button
      className={clsx(
        'flex border-0 outline-none [-webkit-tap-highlight-color:transparent] p-0 cursor-pointer text-chatbox-tint-tertiary active:translate-y-px',
        'bg-transparent hover:text-chatbox-tint-secondary'
      )}
      {...others}
    >
      <Box component="span" w={iconSize} h={iconSize} className="[&>svg]:w-full [&>svg]:h-full">
        {icon}
      </Box>
    </button>
  )
}

export const ScrollToBottomButton = ({ onClick, style }: { onClick?(): void; style?: CSSProperties }) => {
  return (
    <Box className="absolute bottom-5 right-2">
      <Button
        w={38}
        h={38}
        radius={19}
        p={0}
        bg="var(--chatbox-background-primary)"
        c="chatbox-primary"
        className="shadow-xl border-chatbox-border-primary"
        onClick={onClick}
        style={style}
      >
        <IconArrowDown size={20} />
      </Button>
    </Box>
  )
}
