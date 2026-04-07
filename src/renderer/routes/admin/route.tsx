import { Badge, Box, Button, Collapse, Flex, Loader, Paper, Table, Text, Title } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { API_BASE, useAuthStore } from '@/stores/authStore'

interface AppTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface AppRegistration {
  id: string
  name: string
  url: string
  description: string
  status: string
  tools: AppTool[]
  authRequired?: boolean
  authProvider?: string
}

export const Route = createFileRoute('/admin')({
  component: AdminPanel,
})

function AdminPanel() {
  const token = useAuthStore((s) => s.token)
  const [apps, setApps] = useState<AppRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const fetchApps = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/apps/all`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { apps: AppRegistration[] }
      setApps(data.apps)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchApps()
  }, [fetchApps])

  const updateStatus = async (id: string, status: string) => {
    if (!token) return
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await fetch(`${API_BASE}/api/apps/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setActionSuccess(`App status updated to ${status}`)
      await fetchApps()
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const statusColor = (status: string) => {
    if (status === 'approved') return 'green'
    if (status === 'pending') return 'yellow'
    if (status === 'rejected') return 'red'
    return 'gray'
  }

  if (!token) {
    return (
      <Box p="xl">
        <Text>Please log in to access the admin panel.</Text>
      </Box>
    )
  }

  return (
    <Box p="xl" w="100%" h="100vh" style={{ overflowY: 'auto' }}>
      <Title order={3} mb="md">
        App Review
      </Title>

      {actionSuccess && (
        <Paper p="xs" mb="sm" bg="green.1" radius="sm">
          <Text c="green.9" size="sm">
            {actionSuccess}
          </Text>
        </Paper>
      )}
      {actionError && (
        <Paper p="xs" mb="sm" bg="red.1" radius="sm">
          <Text c="red.9" size="sm">
            Error: {actionError}
          </Text>
        </Paper>
      )}

      {loading ? (
        <Flex justify="center" align="center" h={200}>
          <Loader size="md" />
        </Flex>
      ) : error ? (
        <Text c="red">{error}</Text>
      ) : apps.length === 0 ? (
        <Text c="chatbox-secondary">No app registrations found.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th>Name</Table.Th>
              <Table.Th>URL</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {apps.map((app) => (
              <>
                <Table.Tr key={app.id}>
                  <Table.Td
                    style={{ cursor: 'pointer', width: 32 }}
                    onClick={() => toggleExpanded(app.id)}
                  >
                    {expandedIds.has(app.id) ? (
                      <IconChevronDown size={16} />
                    ) : (
                      <IconChevronRight size={16} />
                    )}
                  </Table.Td>
                  <Table.Td>{app.name}</Table.Td>
                  <Table.Td>
                    <Text size="sm" truncate="end" maw={200} component="a" href={app.url} target="_blank">
                      {app.url}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" truncate="end" maw={300}>
                      {app.description}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={statusColor(app.status)} variant="light">
                      {app.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Flex gap="xs">
                      <Button
                        size="compact-xs"
                        color="green"
                        variant="light"
                        disabled={app.status === 'approved'}
                        onClick={() => updateStatus(app.id, 'approved')}
                      >
                        Approve
                      </Button>
                      <Button
                        size="compact-xs"
                        color="red"
                        variant="light"
                        disabled={app.status === 'rejected'}
                        onClick={() => updateStatus(app.id, 'rejected')}
                      >
                        Reject
                      </Button>
                    </Flex>
                  </Table.Td>
                </Table.Tr>
                {expandedIds.has(app.id) && (
                  <Table.Tr key={`${app.id}-tools`}>
                    <Table.Td colSpan={6}>
                      <Collapse in={expandedIds.has(app.id)}>
                        <Paper p="sm" bg="var(--mantine-color-dark-7)" radius="sm">
                          <Text size="xs" fw={600} mb="xs">
                            Tool Schemas ({app.tools.length})
                          </Text>
                          <pre
                            style={{
                              fontSize: 12,
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {JSON.stringify(app.tools, null, 2)}
                          </pre>
                        </Paper>
                      </Collapse>
                    </Table.Td>
                  </Table.Tr>
                )}
              </>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Box>
  )
}
