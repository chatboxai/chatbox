import { Button, Flex, Image, Indicator, ScrollArea, Stack, Text } from '@mantine/core'
import { IconChevronRight, IconFileImport, IconPlus } from '@tabler/icons-react'
import { Link, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderBaseInfo } from 'src/shared/types'
import CustomProviderIcon from '@/components/CustomProviderIcon'
import { ScalableIcon } from '@/components/ScalableIcon'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'

// @ts-ignore - Webpack require.context
const iconContext = require.context('../../../static/icons/providers', false, /\.png$/)
const icons: { name: string; src: string }[] = iconContext.keys().map((key: string) => ({
  name: key.replace('./', '').replace('.png', ''),
  src: iconContext(key),
}))

interface ProviderListProps {
  providers: ProviderBaseInfo[]
  onAddProvider: () => void
  onImportProvider: () => void
  isImporting: boolean
}

export function ProviderList({ providers, onAddProvider, onImportProvider, isImporting }: ProviderListProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const routerState = useRouterState()

  const providerId = useMemo(() => {
    const pathSegments = routerState.location.pathname.split('/').filter(Boolean)
    const providerIndex = pathSegments.indexOf('provider')
    return providerIndex !== -1 ? pathSegments[providerIndex + 1] : undefined
  }, [routerState.location.pathname])

  const { providers: availableProviders } = useProviders()

  return (
    <Stack
      maw={isSmallScreen ? undefined : 256}
      className={clsx(
        'border-solid border-0 border-r border-chatbox-border-primary',
        isSmallScreen ? 'w-full border-r-0' : 'flex-[1_0_auto]'
      )}
      gap={0}
    >
      <ScrollArea flex={1} type={isSmallScreen ? 'never' : 'hover'} scrollHideDelay={100}>
        <Stack p={isSmallScreen ? 0 : 'xs'} gap={isSmallScreen ? 0 : 'xs'}>
          {providers.map((provider) => (
            <Link
              key={provider.id}
              to={provider.id === 'chatbox-ai' ? `/settings/provider/chatbox-ai` : `/settings/provider/$providerId`}
              params={{ providerId: provider.id }}
              className={clsx(
                'no-underline',
                isSmallScreen ? 'border-solid border-0 border-b border-chatbox-border-primary' : ''
              )}
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
                  'cursor-pointer select-none rounded-md',
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
                  <Image w={32} h={32} src={icons.find((icon) => icon.name === provider.id)?.src} alt={provider.name} />
                )}

                <Text
                  span
                  size="sm"
                  flex={isSmallScreen ? 1 : undefined}
                  className="!text-inherit whitespace-nowrap overflow-hidden text-ellipsis"
                >
                  {t(provider.name)}
                </Text>

                {!!availableProviders.find((p) => p.id === provider.id) && (
                  <Indicator
                    size={8}
                    color="chatbox-success"
                    className="ml-auto"
                    disabled={!availableProviders.find((p) => p.id === provider.id)}
                  />
                )}

                {isSmallScreen && (
                  <ScalableIcon icon={IconChevronRight} size={20} className="!text-chatbox-tint-tertiary ml-2" />
                )}
              </Flex>
            </Link>
          ))}
        </Stack>
      </ScrollArea>
      <Stack gap="xs" mx="md" my="sm">
        <Button variant="outline" leftSection={<ScalableIcon icon={IconPlus} />} onClick={onAddProvider}>
          {t('Add')}
        </Button>
        {platform.type !== 'mobile' && (
          <Button
            variant="light"
            leftSection={<ScalableIcon icon={IconFileImport} />}
            onClick={onImportProvider}
            loading={isImporting}
          >
            {t('Import from clipboard')}
          </Button>
        )}
      </Stack>
    </Stack>
  )
}
