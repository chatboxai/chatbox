import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { formatArtifactSize, type WorkArtifact } from '@shared/work-artifacts'
import { IconEye, IconFile, IconShare } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  localWorkPreviewDocument,
  readLocalWorkArtifact,
  shareLocalWorkArtifact,
} from '@/packages/mobile-work-mode/artifacts'

export function MobileWorkArtifactsUI({ artifacts, sessionId }: { artifacts: WorkArtifact[]; sessionId?: string }) {
  const { t, i18n } = useTranslation()
  const [pending, setPending] = useState<string>()
  const busy = Boolean(pending)
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<{ artifact: WorkArtifact; html: string }>()
  const perform = async (artifact: WorkArtifact, action: 'preview' | 'share') => {
    if (!sessionId || busy) return
    setPending(artifact.path)
    setError(undefined)
    try {
      const base64 = await readLocalWorkArtifact(sessionId, artifact)
      if (action === 'preview') setPreview({ artifact, html: localWorkPreviewDocument(base64) })
      else await shareLocalWorkArtifact(artifact, base64)
    } catch {
      setError(String(t('Unable to open file')))
    } finally {
      setPending(undefined)
    }
  }
  return (
    <Stack gap="xs">
      {artifacts.map((artifact) => (
        <Group
          key={artifact.path}
          justify="space-between"
          wrap="wrap"
          p="sm"
          style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 12 }}
        >
          <IconFile size={22} />
          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {artifact.name}
            </Text>
            <Text size="xs" c="dimmed">
              {formatArtifactSize(artifact.size, i18n.language)}
            </Text>
          </Stack>
          <Group gap="xs">
            {/\.html?$/i.test(artifact.path) && (
              <Button
                size="xs"
                leftSection={<IconEye size={16} />}
                variant="light"
                disabled={!sessionId || busy}
                onClick={() => void perform(artifact, 'preview')}
              >
                {t('Preview')}
              </Button>
            )}
            <Button
              size="xs"
              leftSection={<IconShare size={16} />}
              loading={pending === artifact.path}
              variant="light"
              disabled={!sessionId || busy}
              onClick={() => void perform(artifact, 'share')}
            >
              {t('Save / Share')}
            </Button>
          </Group>
        </Group>
      ))}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
      <Modal
        opened={Boolean(preview)}
        onClose={() => setPreview(undefined)}
        title={preview?.artifact.name}
        fullScreen
        styles={{
          body: {
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100dvh - 80px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
            paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          },
        }}
      >
        {preview && (
          <>
            <Button mb="sm" variant="light" loading={busy} onClick={() => void perform(preview.artifact, 'share')}>
              {t('Save / Share')}
            </Button>
            <iframe
              title={preview.artifact.name}
              srcDoc={preview.html}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              style={{ width: '100%', flex: 1, minHeight: 0, border: 0 }}
            />
          </>
        )}
      </Modal>
    </Stack>
  )
}
