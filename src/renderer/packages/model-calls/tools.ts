import { last } from 'lodash'
import type { Message } from 'src/shared/types'
import * as promptFormat from '@/packages/prompts'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { getMessageText, sequenceMessages } from '@/utils/message'
import type { ModelInterface } from '../../../shared/models/types'
import { webSearchExecutor } from '../web-search'
import { generateText } from '.'

/**
 * Extracts and parses JSON from a model response result to find search actions
 * @param result The model response result containing content parts
 * @returns The parsed search action object or null if none found
 */
function extractSearchActionFromResult<T = any>(result: {
  contentParts: Array<{ type: string; text?: string }>
}): T | null {
  const regex = /{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*}/g
  const textPart = result.contentParts.find((part) => part.type === 'text')

  if (!textPart || !textPart.text) {
    return null
  }

  const match = textPart.text.match(regex)
  if (match) {
    for (const jsonString of match) {
      try {
        const jsonObject = JSON.parse(jsonString) as T
        return jsonObject
      } catch (error) {
        console.warn('Failed to parse JSON string:', jsonString, error)
      }
    }
  }

  return null
}

export async function searchByPromptEngineering(model: ModelInterface, messages: Message[], signal?: AbortSignal) {
  const language = settingActions.getLanguage()
  const systemPrompt = promptFormat.contructSearchAction(language)
  const result = await generateText(
    model,
    sequenceMessages([
      {
        id: '',
        role: 'system',
        contentParts: [{ type: 'text', text: systemPrompt }],
      },
      ...messages,
    ])
  )

  const searchAction = extractSearchActionFromResult<{
    action: 'search' | 'proceed'
    query: string
  }>(result)

  if (searchAction && searchAction.action === 'search') {
    const { searchResults } = await webSearchExecutor({ query: searchAction.query }, { abortSignal: signal })
    return { query: searchAction.query, searchResults }
  }

  return { query: '', searchResults: [] }
}

export async function knowledgeBaseSearchByPromptEngineering(
  model: ModelInterface,
  messages: Message[],
  knowledgeBaseId: number
) {
  const language = settingActions.getLanguage()
  const systemPrompt = promptFormat.constructKnowledgeBaseSearchAction(language)
  const result = await generateText(
    model,
    sequenceMessages([
      {
        id: '',
        role: 'system',
        contentParts: [{ type: 'text', text: systemPrompt }],
      },
      ...messages,
    ])
  )

  const searchAction = await extractSearchActionFromResult<{
    action: 'search' | 'proceed'
    query: string
  }>(result)

  if (searchAction && searchAction.action === 'search') {
    const knowledgeBaseController = platform.getKnowledgeBaseController()
    const searchResults = await knowledgeBaseController.search(knowledgeBaseId, searchAction.query)
    return { query: searchAction.query, searchResults }
  }

  return { query: '', searchResults: [] }
}

export async function combinedSearchByPromptEngineering(
  model: ModelInterface,
  messages: Message[],
  knowledgeBaseId?: number,
  signal?: AbortSignal
) {
  const language = settingActions.getLanguage()
  const systemPrompt = promptFormat.constructCombinedSearchAction(language, !!knowledgeBaseId)
  const result = await generateText(
    model,
    sequenceMessages([
      {
        id: '',
        role: 'system',
        contentParts: [{ type: 'text', text: systemPrompt }],
      },
      ...messages,
    ])
  )

  const searchAction = await extractSearchActionFromResult<{
    action: 'search_knowledge_base' | 'search_web' | 'proceed'
    query: string
  }>(result)

  if (searchAction) {
    if (searchAction.action === 'search_knowledge_base' && knowledgeBaseId) {
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      const searchResults = await knowledgeBaseController.search(knowledgeBaseId, searchAction.query)
      return { query: searchAction.query, searchResults, type: 'knowledge_base' as const }
    }
    if (searchAction.action === 'search_web') {
      const { searchResults } = await webSearchExecutor({ query: searchAction.query }, { abortSignal: signal })
      return { query: searchAction.query, searchResults, type: 'web' as const }
    }
  }

  return { query: '', searchResults: [], type: 'none' as const }
}

export function constructMessagesWithSearchResults(
  messages: Message[],
  searchResults: { title: string; snippet: string; link: string; rawContent: string | null }[]
) {
  const systemPrompt = promptFormat.answerWithSearchResults()
  const formattedSearchResults = searchResults
    .map((it, i) => {
      return `[webpage ${i + 1} begin]
Title: ${it.title}
URL: ${it.link}
Content: ${it.snippet}${it.rawContent ? `\nRaw Content: ${it.rawContent}` : ''}
[webpage ${i + 1} end]`
    })
    .join('\n')

  return sequenceMessages([
    {
      id: '',
      role: 'system',
      contentParts: [{ type: 'text', text: systemPrompt }],
    },
    ...messages.slice(0, -1), // 最新一条用户消息和搜索结果放在一起了
    {
      id: '',
      role: 'user',
      contentParts: [
        {
          type: 'text',
          text: `${formattedSearchResults}\nUser Message:\n${getMessageText(
            last(messages) ?? { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] }
          )}`,
        },
      ],
    },
  ])
}

export function constructMessagesWithKnowledgeBaseResults(
  messages: Message[],
  searchResults: Array<{
    id: number
    score: number
    text: string
    fileId: number
    filename: string
    mimeType: string
    chunkIndex: number
  }>
) {
  const systemPrompt = promptFormat.answerWithKnowledgeBaseResults()
  const formattedSearchResults = searchResults
    .map((it, i) => {
      return `[document ${i + 1} begin]
File: ${it.filename}
Content: ${it.text}
[document ${i + 1} end]`
    })
    .join('\n')

  return sequenceMessages([
    {
      id: '',
      role: 'system',
      contentParts: [{ type: 'text', text: systemPrompt }],
    },
    ...messages.slice(0, -1), // 最新一条用户消息和搜索结果放在一起了
    {
      id: '',
      role: 'user',
      contentParts: [
        {
          type: 'text',
          text: `${formattedSearchResults}\nUser Message:\n${getMessageText(
            last(messages) ?? { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] }
          )}`,
        },
      ],
    },
  ])
}
