import { Button, Flex, Image, Indicator, ScrollArea, Stack, Text } from '@mantine/core'
import { AutomationAdjacentAttr, TestId } from '@shared/automation/testids'
import { ModelProviderEnum, type ProviderBaseInfo } from '@shared/types'
import { IconChevronRight, IconPlus } from '@tabler/icons-react'
import { Link, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import CustomProviderIcon from '@/components/CustomProviderIcon'
import Divider from '@/components/common/Divider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { FEATURED_PROVIDER_IDS, ProviderIconImage } from './providerIcons'

interface ProviderListProps {
  providers: ProviderBaseInfo[]
  onAddProvider: () => void
}

export function ProviderList({ providers, onAddProvider }: ProviderListProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const routerState = useRouterState()

  const providerId = useMemo(() => {
    const pathSegments = routerState.location.pathname.split('/').filter(Boolean)
    const providerIndex = pathSegments.indexOf('provider')
    return providerIndex !== -1 ? pathSegments[providerIndex + 1] : undefined
  }, [routerState.location.pathname])

  const { providers: availableProviders } = useProviders()

  const activatedProviderIds = useMemo(() => new Set(availableProviders.map((p) => p.id)), [availableProviders])

  // Sort providers: ChatboxAI first, then activated/custom providers, then featured presets
  const sortedProviders = useMemo(() => {
    const chatboxAI = providers.filter((p) => p.id === ModelProviderEnum.ChatboxAI)
    const activated: ProviderBaseInfo[] = []
    const featured: ProviderBaseInfo[] = []

    for (const p of providers) {
      if (p.id === ModelProviderEnum.ChatboxAI) continue

      if (activatedProviderIds.has(p.id) || p.isCustom) {
        activated.push(p)
      } else if (FEATURED_PROVIDER_IDS.includes(p.id)) {
        featured.push(p)
      }
    }

    return [...chatboxAI, ...activated, ...featured]
  }, [providers, activatedProviderIds])

  return (
    <Stack
      data-testid={TestId.settings.providerList}
      maw={isSmallScreen ? undefined : 256}
      className={clsx(
        'border-solid border-0 border-r border-chatbox-border-primary',
        isSmallScreen ? 'w-full border-r-0' : 'flex-[1_0_auto]'
      )}
      gap={0}
    >
      <ScrollArea flex={1} type={isSmallScreen ? 'never' : 'hover'} scrollHideDelay={100}>
        <Stack p={isSmallScreen ? 0 : 'xs'} gap={isSmallScreen ? 0 : 'xs'}>
          {sortedProviders.map((provider) => (
            <Link
              key={provider.id}
              to={provider.id === 'chatbox-ai' ? `/settings/provider/chatbox-ai` : `/settings/provider/$providerId`}
              params={{ providerId: provider.id }}
              className={'block no-underline'}
              data-testid={TestId.settings.providerItem}
              {...{ [AutomationAdjacentAttr.providerId]: provider.id }}
            >
              <Flex
                component="span"
                align="center"
                gap="xs"
                p="md"
                pr="xl"
                py={isSmallScreen ? 'sm' : undefined}
                c={provider.id === providerId ? 'chatbox-brand' : 'chatbox-secondary'}
                bg={provider.id === providerId ? 'var(--chatbox-background-brand-secondary)' : 'transparent'}
                className={clsx(
                  'cursor-pointer select-none rounded-lg',
                  provider.id === providerId ? '' : 'hover:!bg-chatbox-background-gray-secondary'
                )}
              >
                {provider.isCustom ? (
                  provider.iconUrl ? (
                    <Image w={32} h={32} src={provider.iconUrl} alt={provider.name} />
                  ) : (
                    <CustomProviderIcon providerId={provider.id} providerName={provider.name} size={32} />
                  )
                ) : (
                  <ProviderIconImage providerId={provider.id} size={32} />
                )}

                <Text
                  span
                  size="sm"
                  flex={isSmallScreen ? 1 : undefined}
                  className="!text-inherit whitespace-nowrap overflow-hidden text-ellipsis"
                >
                  {t(provider.name)}
                </Text>

                {activatedProviderIds.has(provider.id) && (
                  <Indicator size={8} color="chatbox-success" className="ml-auto" />
                )}

                {isSmallScreen && (
                  <ScalableIcon icon={IconChevronRight} size={20} className="!text-chatbox-tint-tertiary ml-2" />
                )}
              </Flex>

              {isSmallScreen && <Divider />}
            </Link>
          ))}
        </Stack>
      </ScrollArea>
      <Stack gap="xs" mx="md" my="sm">
        <Button
          data-testid={TestId.settings.addProvider}
          variant="outline"
          leftSection={<ScalableIcon icon={IconPlus} />}
          onClick={onAddProvider}
        >
          {t('Add')}
        </Button>
      </Stack>
    </Stack>
  )
}
