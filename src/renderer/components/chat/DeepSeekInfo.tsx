import { sourcesSchema } from '@chatbox/core/importers/deepseek'
import { Anchor, Stack, Text } from '@mantine/core'
import type { MessageInfoPart } from '@shared/types'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'

export function DeepSeekInfo({ part }: { part: MessageInfoPart }) {
  const { t } = useTranslation()
  if (part.values?.kind === 'deepseek-missing-attachment')
    return (
      <Text size="sm" c="dimmed">
        {t('Attachment unavailable: {{name}}', { name: part.text })}
      </Text>
    )
  if (part.values?.kind === 'deepseek-partial-file')
    return (
      <Text size="sm" c="dimmed">
        {t('File read: {{ratio}}%', { ratio: part.text })}
      </Text>
    )
  const parsed = sourcesSchema.safeParse(part.values?.sources)
  if (!parsed.success) return <Text size="sm">{part.text}</Text>
  return (
    <details>
      <summary>
        {t('References')} ({parsed.data.length})
      </summary>
      <Stack gap="xs" mt="xs">
        {parsed.data.map((source) => (
          <div key={source.url}>
            <Anchor
              size="sm"
              href={source.url}
              onClick={(event) => {
                event.preventDefault()
                void platform.openLink(source.url)
              }}
            >
              {source.title}
            </Anchor>
            {source.snippet ? (
              <Text size="xs" c="dimmed">
                {source.snippet}
              </Text>
            ) : null}
          </div>
        ))}
      </Stack>
    </details>
  )
}
