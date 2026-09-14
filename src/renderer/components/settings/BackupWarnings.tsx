import type { BackupWarning } from '@chatbox/core/backup'
import { Button, Stack, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function BackupWarnings({
  warnings,
  names,
}: {
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
  const headings = [
    t('{{count}} conversations missing from the backup', { count: groups[0].length }),
    t('{{count}} attachments or images missing from the backup', { count: groups[1].length }),
    t('{{count}} search indexes could not be restored', { count: groups[2].length }),
  ]
  if (!warnings.length) return null
  let offset = 0
  const count = groups.reduce((total, group) => total + group.length, 0)
  return (
    <Stack gap="xs" w="100%" style={{ textAlign: 'left' }}>
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
