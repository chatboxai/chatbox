import NiceModal from '@ebay/nice-modal-react'
import { Button, Flex, Stack, Switch, Text, Title } from '@mantine/core'
import type { CopilotDetail } from '@shared/types'
import { IconChevronRight, IconPlus } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useMyCopilots, useRemoteCopilotsByCursor } from '@/hooks/useCopilots'
import { useUIStore } from '@/stores/uiStore'
import CopilotItem from './-components/CopilotItem'

export const Route = createFileRoute('/copilots/')({
  component: Copilots,
})

const MAX_ITEMS_PER_SECTION = 6

function Copilots() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const store = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilotsByCursor({ limit: MAX_ITEMS_PER_SECTION })
  const showCopilotsInNewSession = useUIStore((s) => s.showCopilotsInNewSession)
  const setShowCopilotsInNewSession = useUIStore((s) => s.setShowCopilotsInNewSession)

  const myCopilotsSorted = [
    ...store.copilots.filter((item) => item.starred),
    ...store.copilots.filter((item) => !item.starred),
  ]

  const myCopilotsList = myCopilotsSorted.slice(0, MAX_ITEMS_PER_SECTION)

  const showMyCopilotsSeeAll = myCopilotsSorted.length > 0
  const showRemoteCopilotsSeeAll = remoteCopilots.length > 0

  const handleCreateCopilot = () => {
    void NiceModal.show('copilot-settings', {
      copilot: null,
      mode: 'create',
      onSave: (copilot: CopilotDetail) => {
        store.addOrUpdate(copilot)
      },
    })
  }

  return (
    <Stack px="sm" py="xl" gap="lg" className="max-w-7xl">
      {/* My Created & Added Copilots Section */}
      <section>
        <Flex align="center" gap="md" justify="space-between" mb="md">
          <Flex align="center" gap="md">
            <Title order={5} c="chatbox-primary" className="font-normal">
              {t('My Created & Added Copilots')}
            </Title>
            <Button
              variant="outline"
              size="compact-xs"
              px="xs"
              leftSection={<ScalableIcon icon={IconPlus} size={16} />}
              onClick={handleCreateCopilot}
              className="flex-shrink-0"
            >
              {t('Create')}
            </Button>
          </Flex>
          {showMyCopilotsSeeAll && (
            <Flex
              align="center"
              gap={4}
              className="cursor-pointer text-chatbox-tint-secondary hover:text-chatbox-tint-primary transition-colors"
              onClick={() => navigate({ to: '/copilots/my' })}
            >
              <Text c="chatbox-secondary" size="xs" className="whitespace-nowrap">
                {t('See All')}
              </Text>
              <ScalableIcon icon={IconChevronRight} size={12} className="text-chatbox-tint-secondary" />
            </Flex>
          )}
        </Flex>

        {myCopilotsList.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myCopilotsList.map((copilot) => (
              <CopilotItem key={copilot.id} copilot={copilot} />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Text c="dimmed" size="sm">
              {t('No copilots yet. Create your first one!')}
            </Text>
          </div>
        )}
      </section>

      {/* Chatbox Featured Section */}
      {remoteCopilots.length > 0 && (
        <section>
          <Flex align="center" gap="md" justify="space-between" mb="md">
            <Title order={5} c="chatbox-primary" className="font-normal">
              {t('Chatbox Featured')}
            </Title>
            {showRemoteCopilotsSeeAll && (
              <Flex
                align="center"
                gap={4}
                className="cursor-pointer text-chatbox-tint-secondary hover:text-chatbox-tint-primary transition-colors"
                onClick={() => navigate({ to: '/copilots/featured' })}
              >
                <Text c="chatbox-secondary" size="xs" className="whitespace-nowrap">
                  {t('See All')}
                </Text>
                <ScalableIcon icon={IconChevronRight} size={12} className="text-chatbox-tint-secondary" />
              </Flex>
            )}
          </Flex>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {remoteCopilots.map((copilot) => (
              <CopilotItem key={copilot.id} type="remote" copilot={copilot} />
            ))}
          </div>
        </section>
      )}

      {/* Settings Section */}
      <section>
        <Title order={4} mb="md" className="text-chatbox-tint-primary">
          {t('Settings')}
        </Title>
        <Switch
          checked={showCopilotsInNewSession}
          onChange={(event) => setShowCopilotsInNewSession(event.currentTarget.checked)}
          label={t('Show My Copilots in New Conversations')}
          size="md"
        />
      </section>
    </Stack>
  )
}
