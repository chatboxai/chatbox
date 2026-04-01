import { ActionIcon, Flex, Text } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { createFileRoute, Outlet, useCanGoBack, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import Page from '@/components/layout/Page'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import ExpandableSearch from './-components/ExpandableSearch'

export const Route = createFileRoute('/copilots')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const routerState = useRouterState()
  const isSmallScreen = useIsSmallScreen()
  const canGoBack = useCanGoBack()

  // Get current sub-route
  const pathname = routerState.location.pathname
  const isFeatured = pathname.includes('/copilots/featured')
  const isMy = pathname.includes('/copilots/my')
  const isSearch = pathname.includes('/copilots/search')

  // Determine current page title
  const getSubPageTitle = () => {
    if (isFeatured) return t('Chatbox Featured')
    if (isMy) return t('My Created & Added Copilots')
    if (isSearch) return t('Search')
    return null
  }

  const subPageTitle = getSubPageTitle()

  const handleRootClick = () => {
    navigate({ to: '/copilots' })
  }

  const handleSearch = (term: string) => {
    const value = term.trim()

    const isOnSearchPage = pathname.includes('/copilots/search')

    if (!value) {
      if (isOnSearchPage) {
        router.history.back()
      }
      return
    }

    navigate({
      to: '/copilots/search',
      search: {
        q: value,
      },
      ...(isOnSearchPage ? { replace: true } : {}),
    } as never)
  }

  const breadcrumbTitle = (
    <>
      <Flex align="center" gap="3xs" className="hidden md:flex flex-1">
        <Text
          size="lg"
          fw={subPageTitle ? 400 : 600}
          className={subPageTitle ? 'controls cursor-pointer hover:text-chatbox-tint-primary transition-colors' : ''}
          c={subPageTitle ? 'chatbox-secondary' : 'chatbox-primary'}
          onClick={subPageTitle ? handleRootClick : undefined}
        >
          {t('My Copilots')}
        </Text>

        {subPageTitle && (
          <>
            <ScalableIcon icon={IconChevronRight} size={20} className="text-chatbox-tint-tertiary" />
            <Text size="lg" fw={600}>
              {subPageTitle}
            </Text>
          </>
        )}

        <div className="flex-1" />
      </Flex>

      {
        <Text size="lg" fw={600} className="md:hidden">
          {subPageTitle || t('My Copilots')}
        </Text>
      }
    </>
  )

  return (
    <Page
      title={breadcrumbTitle}
      left={
        isSmallScreen && canGoBack ? (
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
      right={
        <Flex align="center" gap="xxs" className="controls">
          <ExpandableSearch onSearch={handleSearch} />
        </Flex>
      }
    >
      <Outlet />
    </Page>
  )
}
