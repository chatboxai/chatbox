import type { BackupWarning, BackupWarningReason } from '@chatbox/core/backup'
import { Button, Stack, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function BackupWarnings({
  warnings,
  names,
  preservedSessions = [],
}: {
  preservedSessions?: readonly { id: string; name?: string; meta?: { name: string }; legacyTopology?: string }[]
  warnings: BackupWarning[]
  names?: ReadonlyMap<string, string>
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [limit, setLimit] = useState(20)
  const groups = useMemo(() => {
    const unique = [
      ...new Map(
        warnings.map((warning) => [
          JSON.stringify([warning.code, warning.itemType, warning.itemId ?? warning.message]),
          warning,
        ])
      ).values(),
    ]
    return [
      unique.filter((warning) => warning.code === 'session-read-failed'),
      unique.filter(
        (warning) => warning.code === 'resource-read-failed' || warning.code === 'external-resource-skipped'
      ),
      unique.filter((warning) => warning.code === 'rag-rebuild-failed'),
    ]
  }, [warnings])
  const reasons = {
    'session-read-failed': t('Conversation data could not be read and was not included.'),
    'resource-read-failed': t('Attachment or image data could not be read and was not included.'),
    'external-resource-skipped': t('The original external file is not managed by Chatbox and was not included.'),
    'rag-rebuild-failed': t('The attachment search index could not be restored.'),
  }
  const reasonLabels: Record<BackupWarningReason, string> = {
    'session-missing': t('Conversation data could not be found in local storage.'),
    'session-id-mismatch': t('The conversation ID does not match the stored ID.'),
    'resource-missing': t('The attachment or image could not be found in local storage.'),
  }
  const details = (warning: BackupWarning) => {
    if (warning.code === 'external-resource-skipped') return undefined
    return (warning.reason && reasonLabels[warning.reason]) || warning.message.trim() || undefined
  }
  const headings = [
    t('{{count}} conversations missing from the backup', { count: groups[0].length }),
    t('{{count}} attachments or images missing from the backup', { count: groups[1].length }),
    t('{{count}} search indexes could not be restored', { count: groups[2].length }),
  ]
  const preserved = preservedSessions.filter((session) => session.legacyTopology)
  if (!warnings.length && !preserved.length) return null
  let offset = preserved.length
  const count = groups.reduce((total, group) => total + group.length, preserved.length)
  return (
    <Stack gap="xs" w="100%" style={{ textAlign: 'left' }}>
      {preserved.length > 0 && (
        <Text size="sm" c="orange">
          {t('{{count}} conversations preserved in legacy format', { count: preserved.length })}
        </Text>
      )}
      {groups.map(
        (group, index) =>
          group.length > 0 && (
            <Text key={index} size="sm" c="orange">
              {headings[index]}
            </Text>
          )
      )}
      <Button
        variant="subtle"
        size="compact-sm"
        className="self-start"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? t('Hide details') : t('View details')}
      </Button>
      {expanded && (
        <Stack gap="md" mah={240} style={{ overflowY: 'auto' }}>
          {preserved.slice(0, limit).map((session) => (
            <Stack key={session.id} gap={2}>
              <Text size="sm">{session.name || session.meta?.name || names?.get(session.id) || session.id}</Text>
              <Text size="xs" c="dimmed">
                {t(
                  'The conversation has inconsistent branch relationships. Its messages and branches were preserved in legacy JSON format.'
                )}
              </Text>
              <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                {t('Reason: {{reason}}', { reason: session.legacyTopology })}
              </Text>
            </Stack>
          ))}
          {groups.map((group, index) => {
            const shown = group.slice(0, Math.max(0, limit - offset))
            offset += group.length
            return (
              shown.length > 0 && (
                <Stack key={index} gap="xs">
                  <Text size="sm" fw={600}>
                    {headings[index]}
                  </Text>
                  {shown.map((warning, itemIndex) => (
                    <Stack key={itemIndex} gap={2}>
                      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                        {warning.itemName ||
                          (warning.itemId && names?.get(warning.itemId)) ||
                          warning.itemId ||
                          t('Unknown item')}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {reasons[warning.code]}
                      </Text>
                      {details(warning) && (
                        <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                          {t('Reason: {{reason}}', { reason: details(warning) })}
                        </Text>
                      )}
                    </Stack>
                  ))}
                </Stack>
              )
            )
          })}
          {count > limit && (
            <Button variant="subtle" size="compact-sm" onClick={() => setLimit(limit + 20)}>
              {t('Show more ({{count}} remaining)', { count: count - limit })}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  )
}
