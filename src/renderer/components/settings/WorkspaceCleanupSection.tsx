import { Button, Switch, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { SettingRow } from '@/components/settings/SettingsLayout'
import {
  cleanupStaleWorkspaces,
  DEFAULT_WORKSPACE_RETENTION_DAYS,
  formatBytes,
  listWorkspaceUsage,
  WORKSPACE_RETENTION_OPTIONS,
  type WorkspaceUsageSummary,
} from '@/packages/mobile-work-mode/workspace-cleanup'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

/**
 * Mobile-only storage controls for work-mode workspaces (files kept per conversation for code and
 * Python runs). Old conversations are pruned automatically, and the same cleanup can be run by hand.
 */
export function WorkspaceCleanupSection() {
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state.workspaceCleanup)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const enabled = settings?.enabled ?? true
  const retentionDays = settings?.retentionDays ?? DEFAULT_WORKSPACE_RETENTION_DAYS
  const [usage, setUsage] = useState<WorkspaceUsageSummary>()
  const [busy, setBusy] = useState(false)

  const refresh = () => {
    void listWorkspaceUsage()
      .then(setUsage)
      .catch(() => setUsage({ workspaces: [], totalBytes: 0, totalFiles: 0 }))
  }

  useEffect(refresh, [])

  const patch = (value: { enabled?: boolean; retentionDays?: number }) => {
    setSettings({ workspaceCleanup: { enabled, retentionDays, ...value } })
  }

  const runCleanup = async () => {
    setBusy(true)
    try {
      const result = await cleanupStaleWorkspaces({ retentionDays })
      refresh()
      addToast(
        result.removed > 0
          ? t('Removed {{count}} stale workspace(s), freed {{size}}', {
              count: result.removed,
              size: formatBytes(result.freedBytes),
            })
          : t('No workspaces are older than {{days}} days', { days: retentionDays })
      )
    } catch (error) {
      addToast(t('Cleanup failed: {{message}}', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingRow
        id="workspace-usage"
        label={t('Workspace Storage')}
        description={
          usage
            ? t('{{size}} used by {{count}} conversation workspace(s)', {
                size: formatBytes(usage.totalBytes),
                count: usage.workspaces.length,
              })
            : t('Calculating…')
        }
        control={
          <Button variant="subtle" color="chatbox-gray" size="compact-sm" loading={busy} onClick={runCleanup}>
            {t('Clean now')}
          </Button>
        }
      />
      <SettingRow
        id="workspace-auto-cleanup"
        label={t('Automatically clean old workspaces')}
        description={t('Deletes the files a conversation left behind once it has been idle for the period below.')}
        control={<Switch checked={enabled} onChange={(event) => patch({ enabled: event.currentTarget.checked })} />}
      />
      <SettingRow
        id="workspace-retention"
        label={t('Keep workspaces for')}
        control={
          <AdaptiveSelect
            aria-label={String(t('Keep workspaces for'))}
            data={WORKSPACE_RETENTION_OPTIONS.map((days) => ({
              value: String(days),
              label: String(t('{{count}} days', { count: days })),
            }))}
            value={String(retentionDays)}
            onChange={(value) => value && patch({ retentionDays: Number(value) })}
            w={140}
          />
        }
      />
      <Text size="xs" c="chatbox-tertiary" px="sm" pb="sm">
        {t('Applies to work-mode workspaces on this device; conversations themselves are never deleted.')}
      </Text>
    </>
  )
}
