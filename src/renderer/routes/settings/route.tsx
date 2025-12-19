import { ActionIcon, Box, Flex, Stack, Text } from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconBook,
  IconBox,
  IconCategory,
  IconChevronLeft,
  IconChevronRight,
  IconCircleDottedLetterM,
  IconKeyboard,
  IconMessages,
  IconWorldWww
} from '@tabler/icons-react'
import { createFileRoute, Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import Page from '@/components/Page'
import { ScalableIcon } from '@/components/ScalableIcon'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { featureFlags } from '@/utils/feature-flags'

const ITEMS = [
  {
    key: 'provider',
    label: 'Model Provider',
    icon: <IconCategory className="w-full h-full" />,
  },
  {
    key: 'default-models',
    label: 'Default Models',
    icon: <IconBox className="w-full h-full" />,
  },
  {
    key: 'web-search',
    label: 'Web Search',
    icon: <IconWorldWww className="w-full h-full" />,
  },
  ...(featureFlags.mcp
    ? [
        {
          key: 'mcp',
          label: 'MCP',
          icon: <IconCircleDottedLetterM className="w-full h-full" />,
        },
      ]
    : []),
  ...(featureFlags.knowledgeBase
    ? [
        {
          key: 'knowledge-base',
          label: 'Knowledge Base',
          icon: <IconBook className="w-full h-full" />,
        },
      ]
    : []),
  {
    key: 'chat',
    label: 'Chat Settings',
    icon: <IconMessages className="w-full h-full" />,
  },
  ...(platform.type === 'mobile'
    ? []
    : [
        {
          key: 'hotkeys',
          label: 'Keyboard Shortcuts',
          icon: <IconKeyboard className="w-full h-full" />,
        },
      ]),
  {
    key: 'general',
    label: 'General Settings',
    icon: <IconAdjustmentsHorizontal className="w-full h-full" />,
  },
]

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const router = useRouter()
  const routerState = useRouterState()
  const canGoBack = useCanGoBack()
  const isSmallScreen = useIsSmallScreen()

  return (
    <Page
      title={t('Settings')}
      left={
        isSmallScreen && routerState.location.pathname !== '/settings' && canGoBack ? (
          <ActionIcon
            className="controls"
            variant="subtle"
            size={28}
            color="chatbox-secondary"
            mr="sm"
            onClick={() => router.history.back()}
          >
            <IconChevronLeft />
          </ActionIcon>
        ) : undefined
      }
    >
      <SettingsRoot />
      <Toaster richColors position="bottom-center" />
    </Page>
  )
}

export function SettingsRoot() {
  const { t } = useTranslation()
  const routerState = useRouterState()
  const key = routerState.location.pathname.split('/')[2]
  const isSmallScreen = useIsSmallScreen()

  return (
    <Flex flex={1} h="100%" miw={isSmallScreen ? undefined : 800}>
      {(!isSmallScreen || routerState.location.pathname === '/settings') && (
        <Stack
          p={isSmallScreen ? 0 : 'xs'}
          gap={isSmallScreen ? 0 : 'xs'}
          maw={isSmallScreen ? undefined : 256}
          className={clsx(
            'border-solid border-0 border-r overflow-auto border-chatbox-border-primary',
            isSmallScreen ? 'w-full border-r-0' : 'flex-[1_0_auto]'
          )}
        >
          {ITEMS.map((item) => (
            <Link
              disabled={routerState.location.pathname.startsWith(`/settings/${item.key}`)}
              key={item.key}
              to={`/settings/${item.key}` as any}
              className={clsx(
                'no-underline w-full',
                isSmallScreen ? 'border-solid border-0 border-b border-chatbox-border-primary' : ''
              )}
            >
              <Flex
                component="span"
                gap="xs"
                p="md"
                pr="xl"
                py={isSmallScreen ? 'sm' : undefined}
                align="center"
                c={item.key === key ? 'chatbox-brand' : 'chatbox-secondary'}
                bg={item.key === key ? 'var(--chatbox-background-brand-secondary)' : 'transparent'}
                className={clsx(
                  ' cursor-pointer select-none rounded-md',
                  item.key === key ? '' : 'hover:!bg-chatbox-background-gray-secondary'
                )}
              >
                <Box component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                  {item.icon}
                </Box>
                <Text
                  flex={1}
                  lineClamp={1}
                  span={true}
                  className={`!text-inherit ${isSmallScreen ? 'min-h-[32px] leading-[32px]' : ''}`}
                >
                  {t(item.label)}
                </Text>
                {isSmallScreen && (
                  <ScalableIcon icon={IconChevronRight} size={20} className="!text-chatbox-tint-tertiary" />
                )}
              </Flex>
            </Link>
          ))}
        </Stack>
      )}
      {!(isSmallScreen && routerState.location.pathname === '/settings') && (
        <Box flex="1 1 80%" className="overflow-auto">
          <Outlet />
        </Box>
      )}
    </Flex>
  )
}
