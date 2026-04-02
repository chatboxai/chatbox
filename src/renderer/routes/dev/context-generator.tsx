import {
  Badge,
  Button,
  Container,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import type { Message, MessageContentParts, MessageRole } from '@shared/types'
import { IconDeviceFloppy, IconPlayerPlay, IconRefresh, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { estimateTokensFromMessages } from '@/packages/token'
import { createSession } from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/sessionActions'

export const Route = createFileRoute('/dev/context-generator')({
  component: ContextGeneratorPage,
})

type GeneratedMessage = Message & {
  estimatedTokens: number
}

type MessageLengthPreset = 'short' | 'medium' | 'long' | 'mixed'

const MESSAGE_LENGTH_PRESETS: Record<MessageLengthPreset, { min: number; max: number }> = {
  short: { min: 1, max: 3 },
  medium: { min: 3, max: 8 },
  long: { min: 8, max: 20 },
  mixed: { min: 1, max: 20 },
}

const LOREM_WORDS = [
  'adaptive',
  'agent',
  'analysis',
  'artifact',
  'checkpoint',
  'classroom',
  'context',
  'continuity',
  'dialogue',
  'evidence',
  'example',
  'flagship',
  'host',
  'insight',
  'iteration',
  'launch',
  'memory',
  'model',
  'outcome',
  'partner',
  'prompt',
  'recovery',
  'routing',
  'scenario',
  'session',
  'signal',
  'story',
  'student',
  'summary',
  'teacher',
  'validation',
  'workspace',
]

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomWord() {
  return LOREM_WORDS[randomBetween(0, LOREM_WORDS.length - 1)]
}

function generatePseudoSentence(minWords = 8, maxWords = 16) {
  const wordCount = randomBetween(minWords, maxWords)
  const words = Array.from({ length: wordCount }, () => randomWord())
  const sentence = words.join(' ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

function generatePseudoParagraph(minSentences: number, maxSentences: number) {
  return Array.from({ length: randomBetween(minSentences, maxSentences) }, () => generatePseudoSentence()).join(' ')
}

function generatePseudoLines(minLines: number, maxLines: number) {
  return Array.from({ length: randomBetween(minLines, maxLines) }, () => generatePseudoSentence()).join('\n')
}

function generateFakeMessage(role: MessageRole, lengthPreset: MessageLengthPreset): GeneratedMessage {
  const { min, max } = MESSAGE_LENGTH_PRESETS[lengthPreset]
  const text = generatePseudoLines(min, max)

  const contentParts: MessageContentParts = [
    {
      type: 'text',
      text,
    },
  ]

  const message: Message = {
    id: uuidv4(),
    role,
    contentParts,
  }

  return {
    ...message,
    estimatedTokens: estimateTokensFromMessages([message], 'input'),
  }
}

function generateConversation(
  messageCount: number,
  lengthPreset: MessageLengthPreset,
  includeSystemPrompt: boolean
): GeneratedMessage[] {
  const messages: GeneratedMessage[] = []

  if (includeSystemPrompt) {
    const systemText = generatePseudoParagraph(2, 5)
    const systemMessage: Message = {
      id: uuidv4(),
      role: 'system',
      contentParts: [{ type: 'text', text: systemText }],
    }
    messages.push({
      ...systemMessage,
      estimatedTokens: estimateTokensFromMessages([systemMessage], 'input'),
    })
  }

  for (let i = 0; i < messageCount; i++) {
    const role: MessageRole = i % 2 === 0 ? 'user' : 'assistant'
    messages.push(generateFakeMessage(role, lengthPreset))
  }

  return messages
}

function generateToTargetTokens(
  targetTokens: number,
  lengthPreset: MessageLengthPreset,
  includeSystemPrompt: boolean
): GeneratedMessage[] {
  const messages: GeneratedMessage[] = []
  let currentTokens = 0

  if (includeSystemPrompt) {
    const systemText = generatePseudoParagraph(2, 5)
    const systemMessage: Message = {
      id: uuidv4(),
      role: 'system',
      contentParts: [{ type: 'text', text: systemText }],
    }
    const systemTokens = estimateTokensFromMessages([systemMessage], 'input')
    messages.push({
      ...systemMessage,
      estimatedTokens: systemTokens,
    })
    currentTokens += systemTokens
  }

  let i = 0
  const MAX_MESSAGES = 10000
  while (currentTokens < targetTokens && messages.length < MAX_MESSAGES) {
    const role: MessageRole = i % 2 === 0 ? 'user' : 'assistant'
    const msg = generateFakeMessage(role, lengthPreset)
    messages.push(msg)
    currentTokens += msg.estimatedTokens
    i++
  }

  return messages
}

function stripEstimatedTokens(messages: GeneratedMessage[]): Message[] {
  return messages.map(({ estimatedTokens, ...msg }) => msg)
}

function ContextGeneratorPage() {
  const [messageCount, setMessageCount] = useState<number>(10)
  const [targetTokens, setTargetTokens] = useState<number>(4000)
  const [lengthPreset, setLengthPreset] = useState<MessageLengthPreset>('medium')
  const [includeSystemPrompt, setIncludeSystemPrompt] = useState(true)
  const [generationMode, setGenerationMode] = useState<'count' | 'tokens'>('count')
  const [generatedMessages, setGeneratedMessages] = useState<GeneratedMessage[]>([])
  const [sessionName, setSessionName] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)

  const totalTokens = useMemo(() => {
    if (generatedMessages.length === 0) return 0
    return estimateTokensFromMessages(generatedMessages, 'input')
  }, [generatedMessages])

  const handleGenerateByCount = useCallback(() => {
    const messages = generateConversation(messageCount, lengthPreset, includeSystemPrompt)
    setGeneratedMessages(messages)
  }, [messageCount, lengthPreset, includeSystemPrompt])

  const handleGenerateByTokens = useCallback(() => {
    const messages = generateToTargetTokens(targetTokens, lengthPreset, includeSystemPrompt)
    setGeneratedMessages(messages)
  }, [targetTokens, lengthPreset, includeSystemPrompt])

  const handleGenerate = useCallback(() => {
    if (generationMode === 'count') {
      handleGenerateByCount()
    } else {
      handleGenerateByTokens()
    }
  }, [generationMode, handleGenerateByCount, handleGenerateByTokens])

  const handleClear = useCallback(() => {
    setGeneratedMessages([])
  }, [])

  const handleSaveAsSession = useCallback(async () => {
    if (generatedMessages.length === 0) return

    setIsSaving(true)
    try {
      const name =
        sessionName.trim() || `Test Context (${generatedMessages.length} msgs, ${totalTokens.toLocaleString()} tokens)`
      const session = await createSession({
        name,
        messages: stripEstimatedTokens(generatedMessages),
        type: 'chat',
      })
      switchCurrentSession(session.id)
    } finally {
      setIsSaving(false)
    }
  }, [generatedMessages, sessionName, totalTokens])

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="center">
          <div>
            <Group gap="xs" mb="xs">
              <Title order={2}>Context Generator</Title>
              <Badge variant="light" color="blue">
                Dev Tool
              </Badge>
            </Group>
            <Text c="dimmed">
              Generate fake conversation context for testing context management, compaction, and token estimation.
            </Text>
          </div>
        </Group>

        <Paper withBorder shadow="xs" radius="md" p="md">
          <Stack gap="md">
            <Title order={4}>Generation Settings</Title>

            <Group gap="lg" align="flex-end">
              <Select
                label="Generation Mode"
                value={generationMode}
                onChange={(v) => setGenerationMode((v as 'count' | 'tokens') || 'count')}
                data={[
                  { value: 'count', label: 'By Message Count' },
                  { value: 'tokens', label: 'By Target Tokens' },
                ]}
                w={200}
              />

              {generationMode === 'count' ? (
                <NumberInput
                  label="Number of Messages"
                  value={messageCount}
                  onChange={(v) => setMessageCount(typeof v === 'number' ? v : 10)}
                  min={1}
                  max={1000}
                  w={180}
                />
              ) : (
                <NumberInput
                  label="Target Token Count"
                  value={targetTokens}
                  onChange={(v) => setTargetTokens(typeof v === 'number' ? v : 4000)}
                  min={100}
                  max={1000000}
                  step={1000}
                  w={180}
                />
              )}

              <Select
                label="Message Length"
                value={lengthPreset}
                onChange={(v) => setLengthPreset((v as MessageLengthPreset) || 'medium')}
                data={[
                  { value: 'short', label: 'Short (1-3 lines)' },
                  { value: 'medium', label: 'Medium (3-8 lines)' },
                  { value: 'long', label: 'Long (8-20 lines)' },
                  { value: 'mixed', label: 'Mixed (1-20 lines)' },
                ]}
                w={180}
              />

              <Switch
                label="Include System Prompt"
                checked={includeSystemPrompt}
                onChange={(e) => setIncludeSystemPrompt(e.currentTarget.checked)}
              />
            </Group>

            <Group gap="xs">
              <Button leftSection={<ScalableIcon icon={IconPlayerPlay} />} onClick={handleGenerate}>
                Generate
              </Button>
              <Button
                variant="light"
                leftSection={<ScalableIcon icon={IconRefresh} />}
                onClick={handleGenerate}
                disabled={generatedMessages.length === 0}
              >
                Regenerate
              </Button>
              <Button
                variant="subtle"
                color="red"
                leftSection={<ScalableIcon icon={IconTrash} />}
                onClick={handleClear}
                disabled={generatedMessages.length === 0}
              >
                Clear
              </Button>
            </Group>
          </Stack>
        </Paper>

        {generatedMessages.length > 0 && (
          <Paper withBorder shadow="xs" radius="md" p="md">
            <Group justify="space-between" align="center" mb="md">
              <Group gap="lg">
                <div>
                  <Text size="sm" c="dimmed">
                    Messages
                  </Text>
                  <Text size="xl" fw={600}>
                    {generatedMessages.length}
                  </Text>
                </div>
                <div>
                  <Text size="sm" c="dimmed">
                    Total Tokens
                  </Text>
                  <Text size="xl" fw={600}>
                    {totalTokens.toLocaleString()}
                  </Text>
                </div>
                <div>
                  <Text size="sm" c="dimmed">
                    Avg Tokens/Message
                  </Text>
                  <Text size="xl" fw={600}>
                    {Math.round(totalTokens / generatedMessages.length)}
                  </Text>
                </div>
              </Group>
            </Group>

            <Group gap="sm" mb="md">
              <TextInput
                placeholder="Session name (optional)"
                value={sessionName}
                onChange={(e) => setSessionName(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button
                leftSection={<ScalableIcon icon={IconDeviceFloppy} />}
                onClick={handleSaveAsSession}
                loading={isSaving}
              >
                Save as Session
              </Button>
            </Group>

            <ScrollArea h={400} type="auto">
              <Table highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 60 }}>#</Table.Th>
                    <Table.Th style={{ width: 100 }}>Role</Table.Th>
                    <Table.Th style={{ width: 100 }}>Tokens</Table.Th>
                    <Table.Th>Preview</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {generatedMessages.map((msg, idx) => {
                    const textPart = msg.contentParts?.find(
                      (p): p is { type: 'text'; text: string } => p.type === 'text'
                    )
                    const text = textPart?.text || ''
                    const preview = text.length > 100 ? `${text.slice(0, 100)}...` : text

                    return (
                      <Table.Tr key={msg.id}>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {idx + 1}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={msg.role === 'system' ? 'violet' : msg.role === 'user' ? 'blue' : 'green'}
                            variant="light"
                          >
                            {msg.role}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{msg.estimatedTokens}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed" lineClamp={2}>
                            {preview}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        )}

        {generatedMessages.length === 0 && (
          <Paper withBorder shadow="xs" radius="md" p="xl">
            <Text c="dimmed" ta="center">
              No messages generated yet. Configure settings above and click "Generate" to create test context.
            </Text>
          </Paper>
        )}

        <Paper withBorder shadow="xs" radius="md" p="md" className="bg-blue-50 dark:bg-blue-950/20">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              ℹ️ Usage Notes
            </Text>
            <Text size="sm">
              • Token counts are estimated using the cl100k_base tokenizer (GPT-4/ChatGPT compatible)
            </Text>
            <Text size="sm">
              • Messages alternate between user and assistant roles to simulate realistic conversations
            </Text>
            <Text size="sm">• Click "Save as Session" to create a new chat session with the generated messages</Text>
            <Text size="sm">
              • This tool helps test context management features like compaction thresholds and token limits
            </Text>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  )
}

export default ContextGeneratorPage
