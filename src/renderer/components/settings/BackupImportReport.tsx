import type { BackupResult } from '@chatbox/core/backup-v3'
import { getBackupImportIssueMessage } from '@chatbox/i18n/backup-import-issues'
import { Button, Paper, ScrollArea, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function BackupImportReport({ report }: { report: NonNullable<BackupResult['importReport']> }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return (
    <Stack gap="xs" mt="sm">
      {report.settingsSkipped ? (
        <Text size="sm" fw={500}>
          {t('Settings in the backup are invalid and were skipped. Current settings were kept.')}
        </Text>
      ) : null}
      <Text size="sm">
        {t('Imported {{sessions}} conversations and {{messages}} messages.', {
          sessions: report.importedSessions,
          messages: report.importedMessages,
        })}
      </Text>
      <Text size="sm">
        {t('Imported {{resources}} resources and {{globals}} settings records.', {
          resources: report.importedResources,
          globals: report.importedGlobals,
        })}
      </Text>
      <Text size="sm">{t('Skipped {{count}} records.', { count: report.skippedRecords })}</Text>
      {report.issueCount > 0 ? (
        <>
          <Text size="sm">{t('{{count}} import issues found.', { count: report.issueCount })}</Text>
          <Button
            variant="subtle"
            size="compact-sm"
            style={{ alignSelf: 'flex-start' }}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('Hide import details') : t('Show import details')}
          </Button>
          {expanded ? (
            <>
              {report.issueCount > report.issues.length ? (
                <Text size="sm" c="dimmed">
                  {t('{{count}} additional issues are not shown.', { count: report.issueCount - report.issues.length })}
                </Text>
              ) : null}
              <ScrollArea.Autosize mah={280} type="auto" aria-label={String(t('Import details'))}>
                <Stack gap="xs">
                  {report.issues.map((issue, index) => (
                    <Paper key={`${index}-${issue.code}`} withBorder p="sm">
                      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                        {getBackupImportIssueMessage(issue, t)}
                      </Text>
                      {issue.sessionId ? (
                        <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                          {t('Conversation: {{id}}', { id: issue.sessionId })}
                        </Text>
                      ) : null}
                      {issue.objectId ? (
                        <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                          {t('Object: {{id}}', { id: issue.objectId })}
                        </Text>
                      ) : null}
                    </Paper>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </>
          ) : null}
        </>
      ) : null}
    </Stack>
  )
}
