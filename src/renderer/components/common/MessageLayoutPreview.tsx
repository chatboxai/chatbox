import { Box, Flex, type FlexProps, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconCircleCheckFilled } from '@tabler/icons-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from './ScalableIcon'

type MessageLayout = 'left' | 'bubble'

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
  { value: 'left', labelKey: 'Classic', Preview: ClassicLayoutPreview },
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

export function ClassicLayoutPreview({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const avatarSize = size === 'sm' ? 22 : 32
  const lineHeight = size === 'sm' ? 8 : 12
  return (
    <Stack gap="sm">
      {/* Row 1: avatar + short message */}
      <Flex gap="xs" align="center">
        <Box className="rounded-full bg-chatbox-tint-brand flex-shrink-0" w={avatarSize} h={avatarSize} />
        <Flex className="flex-1">
          <Flex
            h={avatarSize}
            w="90%"
            align="center"
            justify="center"
            className="bg-chatbox-background-tertiary rounded-full"
          >
            <Box h={lineHeight} w="80%" bg="#ADB5BD" className="rounded-full" />
          </Flex>
        </Flex>
      </Flex>
      {/* Row 2: avatar + long message */}
      <Flex align="self-start" gap="xs">
        <Box className="rounded-full bg-chatbox-tint-brand flex-shrink-0" w={avatarSize} h={avatarSize} />

        <Stack gap={lineHeight / 2} flex="1">
          <Box h={lineHeight} className="w-full rounded-full bg-chatbox-background-tertiary" />
          <Box h={lineHeight} className="w-full rounded-full bg-chatbox-background-tertiary" />
          <Box h={lineHeight} className="w-full rounded-full bg-chatbox-background-tertiary" />
          <Box h={lineHeight} className="w-1/2 rounded-full bg-chatbox-background-tertiary" />
        </Stack>
      </Flex>
    </Stack>
  )
}

export function BubbleLayoutPreview({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const avatarSize = size === 'sm' ? 22 : 32
  const lineHeight = size === 'sm' ? 8 : 12

  return (
    <Stack gap="sm">
      {/* User bubble (right side) */}
      <Stack
        justify="center"
        h={avatarSize}
        px={avatarSize / 2}
        className="self-end w-3/4 bg-chatbox-tint-brand rounded-full"
      >
        <Box h={lineHeight} className="rounded-sm bg-[rgba(255,255,255,0.32)]"></Box>
      </Stack>
      {/* Assistant bubble (left side) */}
      <Stack
        gap={lineHeight / 2}
        px={lineHeight}
        py={0.75 * lineHeight}
        className="w-3/4 bg-chatbox-background-tertiary rounded-lg"
      >
        <Box h={lineHeight} className="rounded-sm bg-[#ADB5BD] opacity-40 w-3/4"></Box>
        <Box h={lineHeight} className="rounded-sm bg-[#ADB5BD] opacity-40"></Box>
        <Box h={lineHeight} className="rounded-sm bg-[#ADB5BD] opacity-40"></Box>
      </Stack>
    </Stack>
  )
}
