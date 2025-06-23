import type { SearchResultItem } from '@/packages/web-search'
import { alpha, SimpleGrid } from '@mantine/core'
import { Box, Code, Group, Paper, Space, Stack, Text } from '@mantine/core'
import {
  IconArrowRight,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconCode,
  IconLoader,
  IconTool,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageToolCallPart } from 'src/shared/types'

const ToolCallHeader: FC<{ part: MessageToolCallPart; actionText: string; onClick: () => void }> = (props) => {
  return (
    <Paper withBorder radius="md" px="xs" onClick={props.onClick} className="cursor-pointer">
      <Group justify="space-between" className="w-full">
        <Group gap="xs">
          <Text fw={600}>{props.part.toolName}</Text>
          <IconTool size={16} color="var(--mantine-color-chatbox-brand-text)" />
          {props.part.state === 'call' ? (
            <IconLoader size={16} className="animate-spin" color="var(--mantine-color-chatbox-brand-text)" />
          ) : props.part.state === 'error' ? (
            <IconCircleXFilled size={16} color="var(--mantine-color-chatbox-error-text)" />
          ) : (
            <IconCircleCheckFilled size={16} color="var(--mantine-color-chatbox-success-text)" />
          )}
        </Group>
        <Space miw="xl" />
        <Text c="chatbox-brand" size="xs">
          {props.actionText}
        </Text>
      </Group>
    </Paper>
  )
}

type WebBrowsingToolCallPart = MessageToolCallPart<
  { query: string },
  { query: string; searchResults: SearchResultItem[] }
>

const SearchResultCard: FC<{ index: number; result: SearchResultItem }> = ({ index, result }) => {
  return (
    <Link to={result.link} target="_blank" className="no-underline">
      <Paper radius="md" p={8} bg={alpha('var(--mantine-color-gray-6)', 0.1)} maw={200} title={result.title}>
        <Text size="sm" truncate="end" m={0}>
          <b>{index + 1}.</b> {result.title}
        </Text>
        <Text size="xs" truncate="end" c="chatbox-tertiary" m={0} mt={4}>
          {result.link}
        </Text>
      </Paper>
    </Link>
  )
}

const WebSearchToolCallUI: FC<{ part: WebBrowsingToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const [expaned, setExpand] = useState(false)
  return (
    <Stack gap="xs" mb="xs">
      <ToolCallHeader
        part={part}
        actionText={t(expaned ? 'Hide' : 'Expand')}
        onClick={() => setExpand((prev) => !prev)}
      />
      {expaned && (
        <Stack gap="xs">
          <Group gap="xs" my={2}>
            <Text c="chatbox-tertiary" m={0}>
              {t('Search query')}:
            </Text>
            <Text fw={600} size="sm" m={0} fs="italic">
              {part.args.query}
            </Text>
          </Group>
          {part.result && (
            <SimpleGrid cols={{ sm: 3, md: 4 }} spacing="xs">
              {part.result.searchResults.map((result, index) => (
                <SearchResultCard key={result.link} index={index} result={result} />
              ))}
            </SimpleGrid>
          )}
        </Stack>
      )}
      {!expaned && part.result && (
        <Group gap="xs" wrap="nowrap" className="overflow-x-auto" pb="xs">
          {part.result.searchResults.map((result, index) => (
            <SearchResultCard key={result.link} index={index} result={result} />
          ))}
        </Group>
      )}
    </Stack>
  )
}

const GeneralToolCallUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const [expaned, setExpand] = useState(false)
  return (
    <Stack gap="xs" mb="xs">
      <ToolCallHeader
        part={part}
        actionText={t(expaned ? 'Hide' : 'Expand')}
        onClick={() => setExpand((prev) => !prev)}
      />
      {expaned && (
        <Paper withBorder radius="md" p="sm">
          <Stack gap="xs">
            <Group gap="xs" c="chatbox-tertiary">
              <IconCode size={16} />
              <Text fw={600} size="xs" c="chatbox-tertiary" m="0">
                {t('Arguments')}
              </Text>
            </Group>
            <Box>
              <Code block>{JSON.stringify(part.args, null, 2)}</Code>
            </Box>
          </Stack>
          {!!part.result && (
            <Stack gap="xs" className="mt-2">
              <Group gap="xs" c="chatbox-tertiary">
                <IconArrowRight size={16} />
                <Text fw={600} size="xs" c="chatbox-tertiary" m="0">
                  {t('Result')}
                </Text>
              </Group>
              <Box>
                <Code block>{JSON.stringify(part.result, null, 2)}</Code>
              </Box>
            </Stack>
          )}
        </Paper>
      )}
    </Stack>
  )
}

export const ToolCallPartUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  if (part.toolName === 'web_search') {
    return <WebSearchToolCallUI part={part as WebBrowsingToolCallPart} />
  }
  return <GeneralToolCallUI part={part} />
}
