import { Box, Flex, type FlexProps, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconCircleCheckFilled } from '@tabler/icons-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from './ScalableIcon'

type MessageLayout = 'classic' | 'bubble'

type MessageLayoutSelectorProps = {
  value: MessageLayout
  onValueChange: (value: MessageLayout) => void
  size?: 'sm' | 'md'
} & FlexProps

const layoutOptions: {
  value: MessageLayout
  labelKey: string
  Preview: (props: { size?: 'sm' | 'md' }) => React.JSX.Element
}[] = [
  { value: 'classic', labelKey: 'Classic', Preview: ClassicLayoutPreview },
  { value: 'bubble', labelKey: 'Bubble', Preview: BubbleLayoutPreview },
]

export function MessageLayoutSelector({ value, onValueChange, size = 'md', ...props }: MessageLayoutSelectorProps) {
  const { t } = useTranslation()
  return (
    <Flex gap="lg" maw={432} {...props}>
      {layoutOptions.map(({ value: optVal, labelKey, Preview }) => {
        const selected = optVal === value
        return (
          <UnstyledButton key={optVal} onClick={() => onValueChange(optVal)} className="flex-1">
            <Box
              p={size === 'sm' ? 10 : 16}
              className={clsx(
                'rounded-lg border border-solid border-chatbox-border-primary',
                selected ? 'border-chatbox-tint-brand outline-2 outline outline-chatbox-tint-brand' : ''
              )}
            >
              <Preview size={size} />
            </Box>
            <Flex align="center" justify="center" gap={4} mt="xs">
              {selected && <ScalableIcon icon={IconCircleCheckFilled} size={18} className="text-chatbox-tint-brand" />}
              <Text size="sm" fw={selected ? 500 : 400} c={selected ? 'chatbox-brand' : undefined}>
                {t(labelKey)}
              </Text>
            </Flex>
          </UnstyledButton>
        )
      })}
    </Flex>
  )
}

type LayoutPreviewProps = { size?: 'sm' | 'md' }

function previewMetrics(size: LayoutPreviewProps['size']) {
  return size === 'sm' ? { avatar: 18, line: 6, bubble: 18 } : { avatar: 24, line: 8, bubble: 24 }
}

/** The user row: a brand bubble with the user avatar beside it, on the left in classic and the right in bubble. */
function UserPreviewRow({ size, side }: LayoutPreviewProps & { side: 'left' | 'right' }) {
  const { avatar, line, bubble } = previewMetrics(size)
  const avatarDot = <Box className="rounded-full bg-chatbox-background-tertiary flex-shrink-0" w={avatar} h={avatar} />
  return (
    <Flex justify={side === 'right' ? 'flex-end' : 'flex-start'} align="flex-start" gap={6}>
      {side === 'left' && avatarDot}
      <Flex
        h={bubble}
        w="62%"
        align="center"
        px={line + 2}
        className={clsx(
          'rounded-[10px] bg-chatbox-tint-brand',
          side === 'right' ? 'rounded-tr-[3px]' : 'rounded-tl-[3px]'
        )}
      >
        <Box h={line} className="w-full rounded-full bg-[rgba(255,255,255,0.4)]" />
      </Flex>
      {side === 'right' && avatarDot}
    </Flex>
  )
}

function AssistantPreviewLines({ size }: LayoutPreviewProps) {
  const { line } = previewMetrics(size)
  return (
    <Stack gap={line * 0.75}>
      <Box h={line} className="rounded-full bg-chatbox-background-tertiary" />
      <Box h={line} className="rounded-full bg-chatbox-background-tertiary" />
      <Box h={line} className="w-3/5 rounded-full bg-chatbox-background-tertiary" />
    </Stack>
  )
}

/** Classic: the assistant avatar in a row of its own, then the reply flat across the full width. */
export function ClassicLayoutPreview({ size = 'md' }: LayoutPreviewProps) {
  const { avatar, line } = previewMetrics(size)
  return (
    <Stack gap="sm">
      <UserPreviewRow size={size} side="left" />
      <Box>
        <Box className="rounded-full bg-chatbox-tint-brand" w={avatar} h={avatar} mb={line * 0.75} />
        <AssistantPreviewLines size={size} />
      </Box>
    </Stack>
  )
}

/** Bubble: the assistant avatar beside the reply's bubble. */
export function BubbleLayoutPreview({ size = 'md' }: LayoutPreviewProps) {
  const { avatar, line } = previewMetrics(size)
  return (
    <Stack gap="sm">
      <UserPreviewRow size={size} side="right" />
      <Flex align="flex-start" gap={6} pr={18}>
        <Box className="rounded-full bg-chatbox-tint-brand flex-shrink-0" w={avatar} h={avatar} />
        <Box
          flex="1"
          px={line + 2}
          py={line}
          className="rounded-[10px] rounded-tl-[3px] bg-chatbox-background-secondary"
        >
          <AssistantPreviewLines size={size} />
        </Box>
      </Flex>
    </Stack>
  )
}
