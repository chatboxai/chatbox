import { Box, Button, Flex, Loader, Text } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Message, ParallelSlot, ParallelOutputState } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import Markdown, { BlockCodeCollapsedStateProvider } from '@/components/Markdown'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { getSession } from '@/stores/chatStore'

type ParallelOutputViewProps = {
  state: ParallelOutputState
  onAccept: (index: number) => void
}

export function ParallelOutputView({ state, onAccept }: ParallelOutputViewProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  // Fetch session to get real-time message content
  const { data: session } = useQuery({
    queryKey: ['parallel-session', state.sessionId],
    queryFn: () => getSession(state.sessionId),
    refetchInterval: 100, // Refresh frequently during generation
  })

  // Get actual message content
  // - For generating messages: get live content from session for real-time updates
  // - For completed messages: use saved slot.message (may have been removed from session
  //   for context isolation during subsequent parallel generations)
  const getActualMessage = (slot: ParallelSlot): Message | null => {
    if (slot.status === 'generating') {
      // During generation, get live content from session
      const liveMsg = session?.messages.find((m) => m.id === slot.message?.id || m.parallelOutputIndex === slot.index)
      if (liveMsg) return liveMsg
      // Fallback to slot.message if session lookup fails
      return slot.message
    }
    // For completed/waiting/error states, use saved message
    return slot.message
  }

  return (
    <Box className="my-2 w-full">
      <Flex
        gap="md"
        wrap="nowrap"
        className={cn(
          isSmallScreen ? 'flex-col' : 'pb-2'
        )}
        style={!isSmallScreen ? { overflow: 'auto hidden', minWidth: 0 } : undefined}
      >
        {state.slots.map((slot) => (
          <ParallelSlotCard
            key={slot.index}
            slot={slot}
            actualMessage={getActualMessage(slot)}
            isSelected={state.selectedIndex === slot.index}
            isSmallScreen={isSmallScreen}
            onAccept={() => onAccept(slot.index)}
            t={t}
          />
        ))}
      </Flex>
    </Box>
  )
}

type ParallelSlotCardProps = {
  slot: ParallelSlot
  actualMessage: Message | null
  isSelected: boolean
  isSmallScreen: boolean
  onAccept: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

function ParallelSlotCard({ slot, actualMessage, isSelected, isSmallScreen, onAccept, t }: ParallelSlotCardProps) {
  const { status, error, index } = slot
  const messageText = actualMessage ? getMessageText(actualMessage) : ''
  const isGenerating = actualMessage?.generating ?? (status === 'generating')

  return (
    <Box
      className={cn(
        'rounded-lg border p-3 transition-all flex flex-col',
        isSmallScreen ? 'w-full' : 'flex-shrink-0',
        isSelected
          ? 'border-[var(--mantine-color-chatbox-brand-filled)] bg-[var(--chatbox-background-brand-secondary)]'
          : 'border-[var(--chatbox-border-primary)] bg-[var(--chatbox-background-secondary)]'
      )}
      style={!isSmallScreen ? { width: '320px', minWidth: '280px', maxWidth: '400px' } : undefined}
    >
      {/* Header with status */}
      <Flex align="center" justify="space-between" mb="xs" className="flex-shrink-0">
        <Text size="xs" c="chatbox-tertiary">
          #{index + 1}
        </Text>
        {status === 'waiting' && (
          <Flex align="center" gap="xs">
            <Loader size="xs" variant="dots" />
            <Text size="xs" c="dimmed">
              {t('Waiting...')}
            </Text>
          </Flex>
        )}
        {isGenerating && (
          <Flex align="center" gap="xs">
            <Loader size="xs" />
            <Text size="xs" c="chatbox-brand">
              {t('Generating...')}
            </Text>
          </Flex>
        )}
        {status === 'completed' && !isSelected && (
          <Button
            size="xs"
            variant="light"
            color="chatbox-brand"
            leftSection={<IconCheck size={14} />}
            onClick={onAccept}
          >
            {t('Accept this response')}
          </Button>
        )}
        {status === 'completed' && isSelected && (
          <Flex align="center" gap="xs">
            <IconCheck size={14} className="text-chatbox-brand" />
            <Text size="xs" c="chatbox-brand">
              {t('Selected')}
            </Text>
          </Flex>
        )}
        {status === 'error' && (
          <Text size="xs" c="red">
            {t('Error')}
          </Text>
        )}
      </Flex>

      {/* Content */}
      <Box className="flex-1 overflow-y-auto max-h-[300px]">
        {status === 'waiting' && (
          <Text c="dimmed" size="sm">
            {t('Waiting...')}
          </Text>
        )}
        {(isGenerating || status === 'completed') && messageText && (
          <BlockCodeCollapsedStateProvider defaultCollapsed={false}>
            <Markdown generating={isGenerating}>
              {messageText}
            </Markdown>
          </BlockCodeCollapsedStateProvider>
        )}
        {status === 'error' && (
          <Text c="red" size="sm">
            {error || t('An error occurred')}
          </Text>
        )}
      </Box>
    </Box>
  )
}
