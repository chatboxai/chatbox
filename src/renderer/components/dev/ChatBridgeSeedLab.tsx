import { Alert, Badge, Button, Card, Container, Group, Paper, Stack, Text, Title } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCopy,
  IconFlask2,
  IconInfoCircle,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import {
  finishChatBridgeManualSmokeTrace,
  getChatBridgeManualSmokeFixtureMode,
  getChatBridgeManualSmokeTraceSupport,
  startChatBridgeManualSmokeTrace,
  type ChatBridgeManualSmokeActiveRun,
  type ChatBridgeManualSmokeTraceSupport,
} from '@/dev/chatbridgeManualSmoke'
import {
  clearChatBridgeLiveSeedSessions,
  getExistingChatBridgeSeedSessions,
  reseedChatBridgeLiveSeedSessions,
} from '@/dev/chatbridgeSeeds'
import { useSessionList } from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/session/crud'

type NoticeState = {
  tone: 'error' | 'info' | 'success'
  text: string
} | null

export default function ChatBridgeSeedLab() {
  const { sessionMetaList, refetch } = useSessionList()
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [traceSupport, setTraceSupport] = useState<ChatBridgeManualSmokeTraceSupport | null>(null)
  const [activeTraceRuns, setActiveTraceRuns] = useState<Record<string, ChatBridgeManualSmokeActiveRun | undefined>>({})

  const fixtures = useMemo(() => getExistingChatBridgeSeedSessions(sessionMetaList), [sessionMetaList])

  useEffect(() => {
    let disposed = false

    void getChatBridgeManualSmokeTraceSupport().then((support) => {
      if (!disposed) {
        setTraceSupport(support)
      }
    })

    return () => {
      disposed = true
    }
  }, [])

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

  const handleCopyTraceId = async (runId: string) => {
    if (!navigator.clipboard?.writeText) {
      setNotice({
        tone: 'info',
        text: `Trace ID ${runId} is visible in the card, but clipboard access is unavailable in this runtime.`,
      })
      return
    }

    await navigator.clipboard.writeText(runId)
    setNotice({
      tone: 'success',
      text: `Copied trace ID ${runId}.`,
    })
  }

  const handleCompleteTrace = async (fixtureId: string, outcome: 'failed' | 'passed') => {
    const activeTrace = activeTraceRuns[fixtureId]
    if (!activeTrace) {
      return
    }

    await finishChatBridgeManualSmokeTrace(activeTrace.runId, outcome)
    setActiveTraceRuns((current) => ({
      ...current,
      [fixtureId]: undefined,
    }))
    setNotice({
      tone: outcome === 'passed' ? 'success' : 'info',
      text: `Recorded ${outcome} manual smoke outcome for ${activeTrace.fixtureName} as trace ${activeTrace.runId}.`,
    })
  }

  const handleReseedAndOpen = async (fixtureId: string) => {
    setBusyAction(`seed-${fixtureId}`)
    setNotice(null)

    try {
      const [seededSession] = await reseedChatBridgeLiveSeedSessions([fixtureId])
      await refetch()
      if (seededSession) {
        const currentTrace = activeTraceRuns[fixtureId]
        if (currentTrace) {
          await finishChatBridgeManualSmokeTrace(currentTrace.runId, 'superseded')
        }
        switchCurrentSession(seededSession.sessionId)

        const traceResult = await startChatBridgeManualSmokeTrace(seededSession.fixture, seededSession.sessionId)
        if (traceResult.status === 'started') {
          setActiveTraceRuns((current) => ({
            ...current,
            [fixtureId]: traceResult.run,
          }))
          setNotice({
            tone: 'success',
            text: `Started traced manual smoke for ${seededSession.fixture.name}. Run label: ${traceResult.traceLabel}. Trace ID: ${traceResult.traceId}.`,
          })
        } else {
          setActiveTraceRuns((current) => ({
            ...current,
            [fixtureId]: undefined,
          }))
          setNotice({
            tone: seededSession.fixture.smokeSupport === 'legacy-reference' ? 'info' : 'error',
            text: traceResult.support.message,
          })
        }
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
              2. Use <code>Reseed &amp; Open</code> on a supported fixture to start a traced desktop manual smoke run.
            </Text>
            <Text size="sm" c="dimmed">
              3. Complete the audit steps, then record <code>Mark Passed</code> or <code>Mark Failed</code> so the run
              remains inspectable in LangSmith by trace ID.
            </Text>
          </Stack>
        </Paper>

        <Paper withBorder radius="md" p="md">
          <Stack gap="xs">
            <Text fw={600}>Trace support</Text>
            <Text size="sm" c={traceSupport?.enabled ? 'green' : 'dimmed'}>
              {traceSupport?.message ?? 'Checking desktop LangSmith trace support…'}
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
            color={notice.tone === 'success' ? 'green' : notice.tone === 'error' ? 'red' : 'blue'}
            icon={
              <ScalableIcon
                icon={
                  notice.tone === 'success' ? IconFlask2 : notice.tone === 'error' ? IconAlertTriangle : IconInfoCircle
                }
                size={16}
              />
            }
          >
            {notice.text}
          </Alert>
        )}

        <Stack gap="md">
          {fixtures.map(({ fixture, existing }) => (
            <Card key={fixture.id} withBorder shadow="xs" radius="md" p="lg">
              <Stack gap="md">
                {(() => {
                  const fixtureMode = getChatBridgeManualSmokeFixtureMode(fixture.id)
                  const activeTrace = activeTraceRuns[fixture.id]
                  const roleBadge =
                    fixture.fixtureRole === 'active-flagship'
                      ? { color: 'green', label: 'Active flagship' }
                      : fixture.fixtureRole === 'legacy-reference'
                        ? { color: 'orange', label: 'Legacy reference' }
                        : { color: 'blue', label: 'Platform regression' }

                  return (
                    <>
                      <Group justify="space-between" align="start">
                        <div style={{ flex: 1 }}>
                          <Group gap="xs" mb="xs">
                            <Text fw={600}>{fixture.name}</Text>
                            {fixture.coverage.map((label) => (
                              <Badge key={label} variant="light" color="gray">
                                {label}
                              </Badge>
                            ))}
                            <Badge color={roleBadge.color} variant="light">
                              {roleBadge.label}
                            </Badge>
                            <Badge color={fixtureMode.support === 'supported' ? 'teal' : 'orange'} variant="light">
                              {fixtureMode.support === 'supported' ? 'Traceable smoke' : 'Legacy reference'}
                            </Badge>
                          </Group>
                          <Text size="sm" c="dimmed">
                            {fixture.description}
                          </Text>
                          <Text size="sm" c="dimmed" mt={4}>
                            {fixtureMode.message}
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

                      {activeTrace && (
                        <Paper radius="md" p="md" bg="var(--mantine-color-blue-0)">
                          <Stack gap="xs">
                            <Text fw={600} size="sm">
                              Active manual smoke trace
                            </Text>
                            <Text size="sm" c="dimmed">
                              {activeTrace.traceName}
                            </Text>
                            <Text size="sm">Trace ID: {activeTrace.runId}</Text>
                            <Text size="sm">Project: {activeTrace.projectName}</Text>
                            <Group gap="sm">
                              <Button
                                variant="light"
                                leftSection={<ScalableIcon icon={IconCopy} size={16} />}
                                onClick={() => void handleCopyTraceId(activeTrace.runId)}
                              >
                                Copy Trace ID
                              </Button>
                              <Button color="green" onClick={() => void handleCompleteTrace(fixture.id, 'passed')}>
                                Mark Passed
                              </Button>
                              <Button
                                color="red"
                                variant="light"
                                onClick={() => void handleCompleteTrace(fixture.id, 'failed')}
                              >
                                Mark Failed
                              </Button>
                            </Group>
                          </Stack>
                        </Paper>
                      )}
                    </>
                  )
                })()}
              </Stack>
            </Card>
          ))}
        </Stack>
      </Stack>
    </Container>
  )
}
