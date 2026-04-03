import { ActionIcon, Button, Text } from '@mantine/core'
import type { MessageAppPart } from '@shared/types'
import { IconArrowDownRight, IconLayoutBottombarExpand, IconPlayerPause } from '@tabler/icons-react'
import { useEffect, useRef } from 'react'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { ChatBridgeMessagePart } from './ChatBridgeMessagePart'

interface FloatingChatBridgeRuntimeShellProps {
  sessionId: string
  messageId: string
  part: MessageAppPart
  minimized: boolean
  onMinimizeChange: (nextMinimized: boolean) => void
  onJumpToSource: () => void
}

export function FloatingChatBridgeRuntimeShell({
  sessionId,
  messageId,
  part,
  minimized,
  onMinimizeChange,
  onJumpToSource,
}: FloatingChatBridgeRuntimeShellProps) {
  const isSmallScreen = useIsSmallScreen()
  const shellRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (minimized) {
      return
    }

    shellRef.current?.focus({ preventScroll: true })
  }, [minimized, part.appInstanceId])

  if (minimized) {
    return (
      <section
        ref={shellRef}
        tabIndex={-1}
        aria-label={`${part.appName || part.appId} runtime tray minimized`}
        className="border-t border-chatbox-border-primary bg-chatbox-background-primary px-3 py-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)]"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
              Runtime tray
            </Text>
            <Text size="sm" fw={600} className="truncate text-chatbox-primary">
              {part.appName || part.appId}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="subtle" size="compact-sm" onClick={onJumpToSource}>
              Source message
            </Button>
            <Button variant="light" size="compact-sm" onClick={() => onMinimizeChange(false)}>
              Restore app
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      ref={shellRef}
      tabIndex={-1}
      data-testid="chatbridge-floating-runtime-shell"
      aria-label={`${part.appName || part.appId} runtime tray`}
      className={cn(
        'border-t border-chatbox-border-primary bg-chatbox-background-primary px-3 pb-3 pt-2 shadow-[0_-14px_34px_rgba(15,23,42,0.08)]',
        isSmallScreen && 'rounded-t-[24px]'
      )}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
              {isSmallScreen ? 'App sheet' : 'App tray'}
            </Text>
            <Text size="sm" fw={700} className="mt-1 text-chatbox-primary">
              {part.appName || part.appId}
            </Text>
            <Text size="xs" c="dimmed" className="mt-1 whitespace-pre-wrap">
              {isSmallScreen
                ? 'The active runtime stays anchored above the composer while chat continues.'
                : 'The active runtime stays split from scrollback so chat commands do not bury the app.'}
            </Text>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconArrowDownRight size={14} />}
              onClick={onJumpToSource}
            >
              Source
            </Button>
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label="Minimize app tray"
              onClick={() => onMinimizeChange(true)}
            >
              {isSmallScreen ? <IconPlayerPause size={18} /> : <IconLayoutBottombarExpand size={18} />}
            </ActionIcon>
          </div>
        </div>

        <div
          className={cn(
            'overflow-hidden rounded-[24px]',
            isSmallScreen ? 'max-h-[48vh] overflow-y-auto' : 'max-h-[24rem] overflow-y-auto'
          )}
        >
          <ChatBridgeMessagePart part={part} sessionId={sessionId} messageId={messageId} presentation="tray" />
        </div>
      </div>
    </section>
  )
}
