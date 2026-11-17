import { Text } from '@mantine/core'
import { MAX_EDIT_PREVIEW_CHARACTERS } from '@shared/file-edits'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { INPUT_PAYLOAD_MAX_HEIGHT } from './inputSurface'

function PreviewContent({ preview }: { preview: string }) {
  const { t } = useTranslation()
  const lines = useMemo(() => preview.trimEnd().split('\n'), [preview])
  return (
    <pre
      tabIndex={0}
      aria-label={t('Changes') || undefined}
      className="mt-2 overflow-auto whitespace-pre font-mono"
      style={{ maxHeight: INPUT_PAYLOAD_MAX_HEIGHT }}
    >
      {lines.map((line, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: Stateless diff lines are identified by their position in the preview.
          key={index}
          style={{
            display: 'block',
            color: line.startsWith('+')
              ? 'var(--chatbox-tint-success)'
              : line.startsWith('-')
                ? 'var(--chatbox-tint-error)'
                : undefined,
          }}
        >
          {line || ' '}
        </span>
      ))}
    </pre>
  )
}

export function FileEditPreview({ preview, incomplete }: { preview?: string; incomplete?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Persisted/imported sessions also obey the rendering budget.
  const bounded = (preview ?? '').slice(0, MAX_EDIT_PREVIEW_CHARACTERS)
  const truncated = incomplete || (preview?.length ?? 0) > MAX_EDIT_PREVIEW_CHARACTERS
  if (!bounded)
    return truncated ? (
      <Text size="xs" c="chatbox-tertiary" mt={8}>
        {t('Diff preview is incomplete. Review the file before approving, or request smaller edits.')}
      </Text>
    ) : null
  return (
    <details className="mt-2 min-w-0 text-xs" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer">{t('View changes')}</summary>
      {open && (
        <>
          {truncated && (
            <Text size="xs" c="chatbox-tertiary" mt={8}>
              {t('Diff preview is incomplete. Review the file before approving, or request smaller edits.')}
            </Text>
          )}
          {bounded && <PreviewContent preview={bounded} />}
        </>
      )}
    </details>
  )
}
