import { ActionIcon, Box, Flex, Stack, Text } from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconBook,
  IconBox,
  IconCategory,
  IconChevronLeft,
  IconChevronRight,
  IconCircleDottedLetterM,
  IconFileText,
  IconInfoCircle,
  IconKeyboard,
  IconMessages,
  IconWand,
  IconWorldWww,
} from '@tabler/icons-react'
import { createFileRoute, Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import Divider from '@/components/common/Divider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import Page from '@/components/layout/Page'
import { useScreenDownToMD } from '@/hooks/useScreenChange'
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
  ...(featureFlags.skills
    ? [
        {
          key: 'skills',
          label: 'Skills',
          icon: <IconWand className="w-full h-full" />,
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
    key: 'document-parser',
    label: 'Document Parser',
    icon: <IconFileText className="w-full h-full" />,
  },
  {
    key: 'chat',
    label: 'Chat Settings',
    icon: <IconMessages className="w-full h-full" />,
  },
  {
    key: 'hotkeys',
    label: 'Keyboard Shortcuts',
    icon: <IconKeyboard className="w-full h-full" />,
  },
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
  const canGoBack = useCanGoBack()
  // Stack the settings navigation below the `md` breakpoint (~900px): the
  // two-pane layout below forces a 800px min-width, which would otherwise clip
  // the detail pane and force horizontal scrolling between ~600–800px (FABLE §9.2).
  const isStacked = useScreenDownToMD()

  return (
    <Page
      title={t('Settings')}
      left={
        isStacked && canGoBack ? (
          <ActionIcon
            className="controls"
            variant="subtle"
            size={28}
            color="workspaice-secondary"
            mr="sm"
            onClick={() => router.history.back()}
          >
            <IconChevronLeft />
          </ActionIcon>
        ) : undefined
      }
    >
      <SettingsRoot />
      <Toaster
        richColors
        position="bottom-center"
        style={{ zIndex: 2147483647 }}
        toastOptions={{ style: { zIndex: 2147483647 } }}
      />
    </Page>
  )
}

export function SettingsRoot() {
  const { t } = useTranslation()
  const routerState = useRouterState()
  const key = routerState.location.pathname.split('/')[2]
  const isStacked = useScreenDownToMD()

  return (
    <Flex flex={1} h="100%" miw={isStacked ? undefined : 800}>
      {(!isStacked || routerState.location.pathname === '/settings') && (
        <Stack
          p={isStacked ? 0 : 'xs'}
          gap={isStacked ? 0 : 'xs'}
          maw={isStacked ? undefined : 256}
          className={clsx(
            'border-solid border-0 border-r overflow-auto border-workspaice-border-primary',
            isStacked ? 'w-full border-r-0' : 'flex-[1_0_auto]'
          )}
        >
          {ITEMS.map((item) => (
            <Link
              disabled={
                routerState.location.pathname === `/settings/${item.key}` ||
                routerState.location.pathname.startsWith(`/settings/${item.key}/`)
              }
              key={item.key}
              to={`/settings/${item.key}` as any}
              className={'block no-underline w-full'}
            >
              <Flex
                component="span"
                gap="xs"
                p="md"
                pr="xl"
                py={isStacked ? 'sm' : undefined}
                align="center"
                c={item.key === key ? 'workspaice-brand' : 'workspaice-secondary'}
                bg={item.key === key ? 'var(--workspaice-background-brand-secondary)' : 'transparent'}
                className={clsx(
                  ' cursor-pointer select-none rounded-md',
                  item.key === key ? '' : 'hover:!bg-workspaice-background-gray-secondary'
                )}
              >
                <Box component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                  {item.icon}
                </Box>
                <Text
                  flex={1}
                  lineClamp={1}
                  span={true}
                  className={`!text-inherit ${isStacked ? 'min-h-[32px] leading-[32px]' : ''}`}
                >
                  {t(item.label)}
                </Text>
                {isStacked && (
                  <ScalableIcon icon={IconChevronRight} size={20} className="!text-workspaice-tint-tertiary" />
                )}
              </Flex>

              {isStacked && <Divider />}
            </Link>
          ))}

          {isStacked && (
            <Link to={`/about`} className={'block no-underline w-full'}>
              <Flex
                component="span"
                gap="xs"
                p="md"
                pr="xl"
                py="sm"
                align="center"
                c={'workspaice-secondary'}
                className={clsx(' cursor-pointer select-none rounded-md')}
              >
                <Box component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                  <ScalableIcon icon={IconInfoCircle} size={20} />
                </Box>
                <Text
                  flex={1}
                  lineClamp={1}
                  span={true}
                  className={`!text-inherit ${isStacked ? 'min-h-[32px] leading-[32px]' : ''}`}
                >
                  {t('About')}
                </Text>
                <ScalableIcon icon={IconChevronRight} size={20} className="!text-workspaice-tint-tertiary" />
              </Flex>

              {isStacked && <Divider />}
            </Link>
          )}
        </Stack>
      )}
      {!(isStacked && routerState.location.pathname === '/settings') && (
        <Box flex="1 1 80%" className="overflow-auto">
          <Outlet />
        </Box>
      )}
    </Flex>
  )
}
