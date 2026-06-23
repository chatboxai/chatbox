import { getModel } from '@shared/models'
import type { Message, ModelProvider } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { languageNameMap } from '@/i18n/locales'
import { generateText } from '@/packages/model-calls'
import * as promptFormat from '@/packages/prompts'
import { estimateTokens } from '@/packages/token-estimation'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { getMessageText } from '../../../shared/utils/message'
import * as chatStore from '../chatStore'
import { settingsStore } from '../settingsStore'

// Built-in default prompt template for per-session summaries. Use the literal
// `{{languageName}}` placeholder to interpolate the user's display language.
// Resolution order at generation time:
//   1. session.summaryPrompt (if non-empty)
//   2. globalSettings.defaultSessionSummaryPrompt (if non-empty)
//   3. this constant
export const DEFAULT_SESSION_SUMMARY_PROMPT = `You write summaries of chat conversations for the user who participated in them. Respond in {{languageName}}.

First, silently identify what kind of conversation this is — e.g. development task, Q&A learning, ideation/brainstorm, consultation, debugging, creative writing, role-play, casual chat, research, decision-making, or something else. Then tailor the summary to that type:
- Task/output-oriented (dev, writing, analysis): lead with what was built, decided, or produced; list concrete outcomes.
- Learning / Q&A: surface the key concepts explained and questions answered.
- Brainstorm / creative: name the themes explored, ideas generated, and directions worth pursuing.
- Consultation / debugging: state the problem, the diagnosis, and whether it was resolved.
- Role-play / casual chat: a short narrative of key moments — no rigid structure.

Choose the format that fits: 1–4 short paragraphs, a tight bulleted list, or a single line. Do not impose a fixed markdown skeleton. Aim for under ~150 words; keep it tight rather than truncating mid-thought.

Hard rules:
- Do NOT narrate the exchange ("the user asked", "the assistant replied", "then", "随后", "助手返回了" and equivalents in any language are forbidden).
- Stay strictly grounded in the transcript — do not invent facts, links, numbers, names, or quotations.
- No greetings, apologies, meta-commentary, or restating these instructions.
- Do not announce the conversation type explicitly; just let the style reflect it.`

export interface SessionSummary {
  content: string
  generatedAt: number
  modelId: string
  lastMessageId: string
  messageCountAtGen: number
}

export interface SummaryReadResult {
  cached: SessionSummary | null
  stale: boolean
}

const INPUT_TOKEN_BUDGET = 6000

export async function getSessionSummary(sessionId: string): Promise<SummaryReadResult> {
  const key = StorageKeyGenerator.summary(sessionId)
  const cached = await storage.getItem<SessionSummary | null>(key, null)
  if (!cached) {
    return { cached: null, stale: false }
  }
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return { cached, stale: true }
  }
  const visible = session.messages.filter((m) => m.role !== 'system')
  const currentLast = visible[visible.length - 1]?.id ?? ''
  return { cached, stale: cached.lastMessageId !== currentLast }
}

export async function deleteSessionSummary(sessionId: string): Promise<void> {
  const key = StorageKeyGenerator.summary(sessionId)
  await storage.removeItem(key)
}

export async function generateSessionSummary(sessionId: string): Promise<SessionSummary> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }
  const visibleMessages = session.messages.filter((m) => m.role !== 'system')
  const lastMessage = visibleMessages[visibleMessages.length - 1]
  if (!lastMessage) {
    throw new Error('Cannot summarize empty session')
  }

  const globalSettings = settingsStore.getState().getSettings()
  const preferred =
    globalSettings.defaultSummaryModel ?? globalSettings.threadNamingModel ?? globalSettings.defaultChatModel
  if (!preferred) {
    throw new Error('No summary model configured. Set a default summary/chat model in Settings.')
  }

  const settings = {
    ...globalSettings,
    ...session.settings,
    provider: preferred.provider as ModelProvider,
    modelId: preferred.model,
  }

  const budgetedMessages = selectMessagesWithinBudget(visibleMessages, preferred.model)

  const configs = await platform.getConfig()
  const dependencies = await createModelDependencies()
  const model = getModel(settings, globalSettings, configs, dependencies)
  const resolvedPrompt = resolveSummaryPrompt(session.summaryPrompt, globalSettings.defaultSessionSummaryPrompt)
  const prompts = promptFormat.summarizeForUser(budgetedMessages, languageNameMap[settings.language], resolvedPrompt)
  const result = await generateText(model, prompts)
  const content = (result.contentParts ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
  if (!content) {
    throw new Error('Summary model returned empty content')
  }

  const summary: SessionSummary = {
    content,
    generatedAt: Date.now(),
    modelId: preferred.model,
    lastMessageId: lastMessage.id,
    messageCountAtGen: visibleMessages.length,
  }
  const key = StorageKeyGenerator.summary(sessionId)
  await storage.setItemNow(key, summary)
  return summary
}

function resolveSummaryPrompt(sessionPrompt: string | undefined, globalPrompt: string | undefined): string {
  if (sessionPrompt && sessionPrompt.trim().length > 0) {
    return sessionPrompt
  }
  if (globalPrompt && globalPrompt.trim().length > 0) {
    return globalPrompt
  }
  return DEFAULT_SESSION_SUMMARY_PROMPT
}

function selectMessagesWithinBudget(messages: Message[], modelId: string): Message[] {
  if (messages.length === 0) {
    return messages
  }
  const tokenModel = { provider: '', modelId }
  const tokenCounts = messages.map((m) => estimateTokens(getMessageText(m, false, false), tokenModel))
  const totalTokens = tokenCounts.reduce((a, b) => a + b, 0)
  if (totalTokens <= INPUT_TOKEN_BUDGET) {
    return messages
  }

  const earliestCount = Math.min(2, messages.length)
  const earliest = messages.slice(0, earliestCount)
  const earliestTokens = tokenCounts.slice(0, earliestCount).reduce((a, b) => a + b, 0)

  const remainingBudget = INPUT_TOKEN_BUDGET - earliestTokens
  const recent: Message[] = []
  let used = 0
  for (let i = messages.length - 1; i >= earliestCount; i--) {
    const t = tokenCounts[i]
    if (used + t > remainingBudget) {
      break
    }
    used += t
    recent.unshift(messages[i])
  }
  return [...earliest, ...recent]
}
