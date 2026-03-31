import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { IconAlertTriangle, IconFlask2, IconPlayerPlay, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import {
  clearChatBridgeLiveSeedSessions,
  getExistingChatBridgeSeedSessions,
  reseedChatBridgeLiveSeedSessions,
} from '@/dev/chatbridgeSeeds'
import { useSessionList } from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/session/crud'

type NoticeState =
  | {
      tone: 'success' | 'error'
      text: string
    }
  | null

export default function ChatBridgeSeedLab() {
  const { sessionMetaList, refetch } = useSessionList()
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState>(null)

  const fixtures = useMemo(() => getExistingChatBridgeSeedSessions(sessionMetaList), [sessionMetaList])

  const handleReseedAll = async () => {
    setBusyAction('seed-all')
    setNotice(null)

    try {
      const seededSessions = await reseedChatBridgeLiveSeedSessions()
      await refetch()
      setNotice({
        tone: 'success',
        text: `Seeded ${seededSessions.length} ChatBridge sessions. They now appear in the live session list with the seeded prefix.`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Failed to seed the ChatBridge sessions.',
      })
    } finally {
      setBusyAction(null)
    }
  }

  const handleClearAll = async () => {
    setBusyAction('clear-all')
    setNotice(null)

    try {
      await clearChatBridgeLiveSeedSessions()
      await refetch()
      setNotice({
        tone: 'success',
        text: 'Removed the seeded ChatBridge sessions and their stored fixture blobs.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Failed to remove the seeded ChatBridge sessions.',
      })
    } finally {
      setBusyAction(null)
    }
  }

  const handleReseedAndOpen = async (fixtureId: string) => {
    setBusyAction(`seed-${fixtureId}`)
    setNotice(null)

    try {
      const [seededSession] = await reseedChatBridgeLiveSeedSessions([fixtureId])
      await refetch()
      if (seededSession) {
        switchCurrentSession(seededSession.sessionId)
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Failed to reseed the requested ChatBridge session.',
      })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <div>
          <Group gap="xs" mb="xs">
            <Title order={2}>ChatBridge Seed Lab</Title>
            <Badge variant="light" color="blue">
              Live Inspection
            </Badge>
          </Group>
          <Text c="dimmed">
            Seed real ChatBridge sessions into storage, open them through the normal chat route, and verify the host
            shell, thread history, and HTML preview in the live app instead of a disconnected mock.
          </Text>
        </div>

        <Paper withBorder radius="md" p="md">
          <Stack gap="sm">
            <Text fw={600}>How to use this lab</Text>
            <Text size="sm" c="dimmed">
              1. Click <code>Seed All Sessions</code> after a relevant ChatBridge change.
            </Text>
            <Text size="sm" c="dimmed">
              2. Open the seeded sessions from the normal sidebar or use <code>Reseed &amp; Open</code> below.
            </Text>
            <Text size="sm" c="dimmed">
              3. Follow the scenario audit steps on each card. The workflow docs are updated so future relevant stories
              must keep this lab current.
            </Text>
          </Stack>
        </Paper>

        <Group gap="sm">
          <Button
            leftSection={<ScalableIcon icon={IconRefresh} size={16} />}
            loading={busyAction === 'seed-all'}
            onClick={() => void handleReseedAll()}
          >
            Seed All Sessions
          </Button>
          <Button
            variant="light"
            leftSection={<ScalableIcon icon={IconTrash} size={16} />}
            loading={busyAction === 'clear-all'}
            onClick={() => void handleClearAll()}
          >
            Clear Seeded Sessions
          </Button>
        </Group>

        {notice && (
          <Alert
            color={notice.tone === 'success' ? 'green' : 'red'}
            icon={<ScalableIcon icon={notice.tone === 'success' ? IconFlask2 : IconAlertTriangle} size={16} />}
          >
            {notice.text}
          </Alert>
        )}

        <Stack gap="md">
          {fixtures.map(({ fixture, existing }) => (
            <Card key={fixture.id} withBorder shadow="xs" radius="md" p="lg">
              <Stack gap="md">
                <Group justify="space-between" align="start">
                  <div style={{ flex: 1 }}>
                    <Group gap="xs" mb="xs">
                      <Text fw={600}>{fixture.name}</Text>
                      {fixture.coverage.map((label) => (
                        <Badge key={label} variant="light" color="gray">
                          {label}
                        </Badge>
                      ))}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {fixture.description}
                    </Text>
                  </div>
                  <Badge color={existing ? 'green' : 'gray'} variant="light">
                    {existing ? 'Seeded in live app' : 'Not seeded'}
                  </Badge>
                </Group>

                <Paper radius="md" p="md" bg="var(--mantine-color-gray-0)">
                  <Stack gap="xs">
                    <Text fw={600} size="sm">
                      Audit this session
                    </Text>
                    {fixture.auditSteps.map((step) => (
                      <div key={step.action}>
                        <Text size="sm" fw={500}>
                          {step.action}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {step.expected}
                        </Text>
                      </div>
                    ))}
                  </Stack>
                </Paper>

                <Group gap="sm">
                  <Button
                    leftSection={<ScalableIcon icon={IconRefresh} size={16} />}
                    loading={busyAction === `seed-${fixture.id}`}
                    onClick={() => void handleReseedAndOpen(fixture.id)}
                  >
                    Reseed &amp; Open
                  </Button>
                  {existing && (
                    <Button
                      variant="light"
                      leftSection={<ScalableIcon icon={IconPlayerPlay} size={16} />}
                      onClick={() => switchCurrentSession(existing.id)}
                    >
                      Open Seeded Session
                    </Button>
                  )}
                </Group>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Stack>
    </Container>
  )
}
