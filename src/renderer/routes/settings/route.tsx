import Page from '@/components/Page'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { featureFlags } from '@/utils/feature-flags'
import { Box, Flex, Stack, Text } from '@mantine/core'
import { IconButton, Box as MuiBox, useTheme } from '@mui/material'
import {
  IconAdjustmentsHorizontal,
  IconBox,
  IconCategory,
  IconChevronRight,
  IconCircleDottedLetterM,
  IconKeyboard,
  IconMessages,
  IconWorldWww,
} from '@tabler/icons-react'
import { createFileRoute, Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'

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

function RouteComponent() {
  const { t } = useTranslation()
  const router = useRouter()
  const routerState = useRouterState()
  const canGoBack = useCanGoBack()
  const key = routerState.location.pathname.split('/')[2]
  const isSmallScreen = useIsSmallScreen()
  const theme = useTheme()

  return (
    <Page
      title={t('Settings')}
      left={
        isSmallScreen && routerState.location.pathname !== '/settings' && canGoBack ? (
          <MuiBox onClick={() => router.history.back()}>
            <IconButton
              sx={
                isSmallScreen
                  ? {
                      borderColor: theme.palette.action.hover,
                      borderStyle: 'solid',
                      borderWidth: 1,
                    }
                  : {}
              }
            >
              <ChevronLeft size="20" />
            </IconButton>
          </MuiBox>
        ) : undefined
      }
    >
      <Flex flex={1} h="100%">
        {(!isSmallScreen || routerState.location.pathname === '/settings') && (
          <Stack
            p={isSmallScreen ? 0 : 'xs'}
            gap={isSmallScreen ? 0 : 'xs'}
            className={clsx(
              'border-solid border-0 border-r overflow-auto border-[var(--mantine-color-chatbox-border-primary-outline)]',
              isSmallScreen ? 'w-full border-r-0' : ''
            )}
          >
            {ITEMS.map((item) => (
              <Link
                disabled={routerState.location.pathname.startsWith(`/settings/${item.key}`)}
                key={item.key}
                to={`/settings/${item.key}` as any}
                className={clsx(
                  'no-underline',
                  isSmallScreen
                    ? 'border-solid border-0 border-b border-[var(--mantine-color-chatbox-border-primary-outline)]'
                    : ''
                )}
              >
                <Flex
                  component="span"
                  gap="xs"
                  p="md"
                  align="center"
                  c={item.key === key ? 'chatbox-brand' : 'chatbox-secondary'}
                  bg={item.key === key ? 'var(--mantine-color-chatbox-brand-light)' : 'transparent'}
                  className={clsx(
                    ' cursor-pointer select-none rounded-md hover:!bg-[var(--mantine-color-chatbox-brand-outline-hover)]',
                    isSmallScreen ? '' : 'w-[16rem]'
                  )}
                >
                  <Box component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                    {item.icon}
                  </Box>
                  <Text flex={1} lineClamp={1} span={true} className="!text-inherit">
                    {t(item.label)}
                  </Text>
                  {isSmallScreen && (
                    <IconChevronRight size={20} className="!text-[var(--mantine-color-chatbox-tertiary-outline)]" />
                  )}
                </Flex>
              </Link>
            ))}
          </Stack>
        )}
        {!(isSmallScreen && routerState.location.pathname === '/settings') && (
          <Box flex={1} className="overflow-auto">
            <Outlet />
          </Box>
        )}
      </Flex>
      <Toaster richColors position="bottom-center" />
    </Page>
  )
}
