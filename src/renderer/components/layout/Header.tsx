import type { SessionHeader } from '@chatbox/core/ports'
import { Flex, Text, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Session } from '@shared/types'
import { IconChevronDown, IconPencil, IconPlus } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { syncSessionAutoTitleOnOpen } from '@/stores/session/naming'
import { uiStore } from '@/stores/uiStore'
import { ICON_SIZE, ICON_STROKE_WIDTH, IconButton } from '../common/IconButton'
import { ScalableIcon } from '../common/ScalableIcon'
import { PageHeader } from './Page'
import Toolbar, { SessionMenu } from './Toolbar'

export default function Header(props: { session: Session | SessionHeader }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isSmallScreen = useIsSmallScreen()

  const { session: currentSession } = props
  const visibleSessionId = currentSession.id

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync only when the visible session id changes; message-driven naming is handled by session-updated in registerSessionUiEffects
  useEffect(() => {
    let active = true
    void syncSessionAutoTitleOnOpen(currentSession, () => active)
    return () => {
      active = false
    }
  }, [visibleSessionId])

  const editCurrentSession = () => {
    if (!currentSession) {
      return
    }
    uiStore.getState().openSessionPanel(currentSession.id, 'settings')
  }

  if (isSmallScreen) {
    return (
      <PageHeader
        title={
          <SessionMenu session={currentSession} onEditSettings={editCurrentSession}>
            <UnstyledButton className="controls min-w-0" data-testid={TestId.session.headerMenuTrigger}>
              <Flex align="center" gap={4} miw={0}>
                <Text component="span" fw={600} fz={16} lh="24px" truncate="end" className="min-w-0">
                  {currentSession?.name}
                </Text>
                <ScalableIcon
                  icon={IconChevronDown}
                  size={ICON_SIZE.inline}
                  strokeWidth={ICON_STROKE_WIDTH}
                  className="shrink-0 text-chatbox-tertiary"
                />
              </Flex>
            </UnstyledButton>
          </SessionMenu>
        }
        right={
          <IconButton
            icon={IconPlus}
            size="lg"
            iconSize={ICON_SIZE.touch}
            aria-label={t('New Chat')}
            onClick={() => navigate({ to: '/' })}
          />
        }
      />
    )
  }

  return (
    <PageHeader
      title={
        <Flex align="center" miw={0}>
          <Text component="h1" m={0} fw={600} fz={14} lh="20px" truncate="end" className="min-w-0">
            {currentSession?.name}
          </Text>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                className="controls"
                icon={IconPencil}
                iconSize={ICON_SIZE.inline}
                color="chatbox-tertiary"
                ml={4}
                aria-label={t('Customize settings for the current conversation')}
                onClick={editCurrentSession}
              />
            </TooltipTrigger>
            <TooltipContent>{t('Customize settings for the current conversation')}</TooltipContent>
          </Tooltip>
        </Flex>
      }
      right={<Toolbar session={currentSession} />}
    />
  )
}
