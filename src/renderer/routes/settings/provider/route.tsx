import CustomProviderIcon from '@/components/CustomProviderIcon'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSettings } from '@/hooks/useSettings'
import { Box, Flex, Stack, Text, Image, Button, Modal, TextInput, Select, Indicator } from '@mantine/core'
import { IconChevronRight, IconPlus } from '@tabler/icons-react'
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemProviders } from 'src/shared/defaults'
import { ModelProviderType } from 'src/shared/types'
import { v4 as uuidv4 } from 'uuid'

const iconContext = (require as any).context('../../../static/icons/providers', false, /\.png$/)
const icons: { name: string; src: string }[] = iconContext.keys().map((key: string) => ({
  name: key.replace('./', '').replace('.png', ''), // 获取图片名称
  src: iconContext(key), // 获取图片路径
}))

export const Route = createFileRoute('/settings/provider')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isSmallScreen = useIsSmallScreen()
  const routerState = useRouterState()
  const providerId = routerState.location.pathname.split('/')[3]
  const { settings, setSettings } = useSettings()

  const providers = useMemo(() => [...SystemProviders, ...(settings.customProviders || [])], [settings.customProviders])

  const { providers: availableProviders } = useProviders()

  const [newProviderModalOpened, setNewProviderModalOpened] = useState(false)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderMode] = useState(ModelProviderType.OpenAI)

  useEffect(() => {
    if (routerState.location.search.custom) {
      setNewProviderModalOpened(true)
    }
  }, [routerState.location.search])

  return (
    <Flex h="100%">
      {(!isSmallScreen || routerState.location.pathname === '/settings/provider') && (
        <Stack
          className={clsx(
            'border-solid border-0 border-r border-[var(--mantine-color-chatbox-border-primary-outline)] ',
            isSmallScreen ? 'w-full border-r-0' : ''
          )}
          gap={0}
        >
          <Stack p={isSmallScreen ? 0 : 'xs'} gap={isSmallScreen ? 0 : 'xs'} flex={1} className="overflow-auto">
            {providers.map((provider) => (
              <Link
                key={provider.id}
                to={`/settings/provider/$providerId`}
                params={{ providerId: provider.id }}
                className={clsx(
                  'no-underline',
                  isSmallScreen
                    ? 'border-solid border-0 border-b border-[var(--mantine-color-chatbox-border-primary-outline)]'
                    : ''
                )}
              >
                <Flex
                  component="span"
                  align="center"
                  gap="xs"
                  p="md"
                  py={isSmallScreen ? 'sm' : undefined}
                  c={provider.id === providerId ? 'chatbox-brand' : 'chatbox-secondary'}
                  bg={provider.id === providerId ? 'var(--mantine-color-chatbox-brand-light)' : 'transparent'}
                  className="cursor-pointer select-none rounded-md hover:!bg-[var(--mantine-color-chatbox-brand-outline-hover)]"
                >
                  {provider.isCustom ? (
                    <CustomProviderIcon providerId={provider.id} providerName={provider.name} size={36} />
                  ) : (
                    <Image w={36} h={36} src={icons.find((icon) => icon.name === provider.id)?.src} />
                  )}

                  <Text
                    span
                    size="sm"
                    w={isSmallScreen ? undefined : 132}
                    flex={isSmallScreen ? 1 : undefined}
                    className="!text-inherit"
                  >
                    {t(provider.name)}
                  </Text>

                  <Indicator
                    size={8}
                    ml={12}
                    color="chatbox-success"
                    className="ml-auto"
                    disabled={!availableProviders.find((p) => p.id === provider.id)}
                  />

                  {isSmallScreen && (
                    <IconChevronRight
                      size={20}
                      className="!text-[var(--mantine-color-chatbox-tertiary-outline)] ml-2"
                    />
                  )}
                </Flex>
              </Link>
            ))}
          </Stack>
          <Button
            variant="outline"
            leftSection={<IconPlus size={16} />}
            mx="md"
            my="sm"
            onClick={() => setNewProviderModalOpened(true)}
          >
            {t('Add')}
          </Button>
        </Stack>
      )}
      {!(isSmallScreen && routerState.location.pathname === '/settings/provider') && (
        <Box flex={1} p="md" className="overflow-auto">
          <Outlet />
        </Box>
      )}

      <Modal
        size="sm"
        opened={newProviderModalOpened}
        onClose={() => setNewProviderModalOpened(false)}
        centered
        title={t('Add provider')}
      >
        <Stack gap="xs">
          <Text>{t('Name')}</Text>
          <TextInput value={newProviderName} onChange={(e) => setNewProviderName(e.currentTarget.value)} />
          <Text>{t('API Mode')}</Text>
          <Select
            value={newProviderMode}
            data={[
              {
                value: ModelProviderType.OpenAI,
                label: t('OpenAI API Compatible'),
              },
            ]}
          />
          <Flex justify="flex-end" gap="sm" mt="sm">
            <Button variant="light" color="chatbox-gray" onClick={() => setNewProviderModalOpened(false)}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={() => {
                const pid = 'custom-provider-' + uuidv4()
                setSettings({
                  customProviders: [
                    ...(settings.customProviders || []),
                    {
                      id: pid,
                      name: newProviderName,
                      type: ModelProviderType.OpenAI,
                      isCustom: true,
                    },
                  ],
                })
                setNewProviderModalOpened(false)
                navigate({
                  to: '/settings/provider/$providerId',
                  params: {
                    providerId: pid,
                  },
                })
              }}
            >
              {t('Add')}
            </Button>
          </Flex>
        </Stack>
      </Modal>
    </Flex>
  )
}
