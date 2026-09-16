import { ActionIcon, Button, Loader, Modal, Stack, Text } from '@mantine/core'
import {
  formatArtifactSize,
  isPreviewableWorkArtifact,
  type WorkArtifact,
  type WorkArtifactKind,
  workArtifactBadgeLabel,
  workArtifactKind,
} from '@shared/work-artifacts'
import { IconEye, IconFile, IconShare } from '@tabler/icons-react'
import clsx from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  localWorkPreviewDocument,
  readLocalWorkArtifact,
  shareLocalWorkArtifact,
} from '@/packages/mobile-work-mode/artifacts'

type ArtifactAction = 'preview' | 'share'

const kindColor: Record<WorkArtifactKind, string> = {
  web: 'blue',
  spreadsheet: 'green',
  image: 'orange',
  document: 'gray',
  other: 'gray',
}

export function MobileWorkArtifactsUI({ artifacts, sessionId }: { artifacts: WorkArtifact[]; sessionId?: string }) {
  const { t, i18n } = useTranslation()
  const [pending, setPending] = useState<{ path: string; action: ArtifactAction }>()
  const busy = Boolean(pending)
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<{ artifact: WorkArtifact; html: string }>()
  const kindLabels: Record<WorkArtifactKind, string> = {
    web: t('Web page'),
    spreadsheet: t('Spreadsheet'),
    image: t('Image'),
    document: t('Document'),
    other: '',
  }
  const perform = async (artifact: WorkArtifact, action: ArtifactAction) => {
    if (!sessionId || busy) return
    setPending({ path: artifact.path, action })
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
    <Stack gap={10}>
      {artifacts.map((artifact) => {
        const previewable = isPreviewableWorkArtifact(artifact)
        const kind = workArtifactKind(artifact.path)
        const badge = workArtifactBadgeLabel(artifact.path)
        const color = kindColor[kind]
        const disabled = !sessionId || busy
        const pendingAction = pending?.path === artifact.path ? pending.action : undefined
        const subtitle = [
          artifact.size === null ? '' : formatArtifactSize(artifact.size, i18n.language),
          kindLabels[kind],
        ]
          .filter(Boolean)
          .join(' · ')
        const shareButton = (
          <ActionIcon
            variant="default"
            size={44}
            h={previewable ? 40 : 44}
            radius={previewable ? 10 : 12}
            aria-label={t('Save / Share')}
            title={t('Save / Share')}
            disabled={disabled}
            onClick={() => void perform(artifact, 'share')}
            className="flex-none"
            style={{ color: 'var(--chatbox-tint-secondary)' }}
          >
            {pendingAction === 'share' ? <Loader size={16} /> : <IconShare size={18} stroke={1.8} />}
          </ActionIcon>
        )
        return (
          <div
            key={artifact.path}
            className={clsx(
              'flex min-w-0 gap-3 rounded-[14px] border border-solid bg-chatbox-background-primary p-3',
              previewable ? 'flex-col border-chatbox-border-secondary' : 'items-center border-chatbox-border-primary'
            )}
          >
            <div className={clsx('flex min-w-0 gap-3', previewable ? 'items-start' : 'flex-1 items-center')}>
              <span
                aria-hidden
                className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] text-[11px] font-bold"
                style={{
                  background: `var(--mantine-color-${color}-light)`,
                  color: `var(--mantine-color-${color}-light-color)`,
                }}
              >
                {badge || <IconFile size={20} stroke={1.8} />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <Text
                  fz={15}
                  fw={500}
                  lh={1.3}
                  lineClamp={previewable ? 2 : undefined}
                  truncate={!previewable}
                  title={artifact.name}
                  className="break-words"
                >
                  {artifact.name}
                </Text>
                <Text size="xs" lh={1.2} c="chatbox-tertiary" truncate>
                  {subtitle}
                </Text>
              </span>
            </div>
            {previewable ? (
              <div className="flex gap-2">
                <Button
                  flex={1}
                  h={40}
                  radius={10}
                  leftSection={<IconEye size={17} stroke={1.9} />}
                  loading={pendingAction === 'preview'}
                  disabled={disabled && pendingAction !== 'preview'}
                  onClick={() => void perform(artifact, 'preview')}
                >
                  {t('Preview')}
                </Button>
                {shareButton}
              </div>
            ) : (
              shareButton
            )}
          </div>
        )
      })}
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
