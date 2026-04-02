import * as Sentry from '@sentry/react'
import { getModel } from '@shared/models'
import { ApiError, NetworkError } from '@shared/models/errors'
import type { ModelProvider } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { languageNameMap } from '@/i18n/locales'
import { generateText } from '@/packages/model-calls'
import * as promptFormat from '@/packages/prompts'
import platform from '@/platform'
import * as chatStore from '../chatStore'
import { settingsStore } from '../settingsStore'
import { activeNameGenerations, pendingNameGenerations } from './state'

/**
 * Modify session name and thread name
 */
export async function modifyNameAndThreadName(sessionId: string, name: string) {
  await chatStore.updateSession(sessionId, { name, threadName: name })
}

/**
 * Modify session's current thread name
 */
export async function modifyThreadName(sessionId: string, threadName: string) {
  await chatStore.updateSession(sessionId, { threadName })
}

/**
 * Internal function to generate a name for a session/thread
 */
async function _generateName(sessionId: string, modifyName: (sessionId: string, name: string) => Promise<void>) {
  const session = await chatStore.getSession(sessionId)
  const globalSettings = settingsStore.getState().getSettings()
  if (!session) {
    return
  }
  const settings = {
    ...globalSettings,
    ...session.settings,
    ...(session.type === 'picture'
      ? {
          modelId: 'gpt-4o-mini',
        }
      : {}),
    ...(globalSettings.threadNamingModel
      ? {
          provider: globalSettings.threadNamingModel.provider as ModelProvider,
          modelId: globalSettings.threadNamingModel.model,
        }
      : {}),
  }
  try {
    const configs = await platform.getConfig()
    const dependencies = await createModelDependencies()
    const model = getModel(settings, globalSettings, configs, dependencies)
    const result = await generateText(
      model,
      promptFormat.nameConversation(
        session.messages.filter((m) => m.role !== 'system').slice(0, 4),
        languageNameMap[settings.language]
      ),
      {
        name: 'chatbox.session.naming',
        metadata: {
          sessionId,
        },
        tags: ['session-naming'],
      }
    )
    let name =
      result.contentParts
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') || ''
    name = name.replace(/['""\u201C\u201D]/g, '').replace(/<think>.*?<\/think>/g, '')
    await modifyName(sessionId, name)
  } catch (e: unknown) {
    if (!(e instanceof ApiError || e instanceof NetworkError)) {
      Sentry.captureException(e)
    }
  }
}

/**
 * Generate session name and thread name
 */
async function generateNameAndThreadName(sessionId: string) {
  return await _generateName(sessionId, modifyNameAndThreadName)
}

/**
 * Generate thread name only
 */
async function generateThreadName(sessionId: string) {
  return await _generateName(sessionId, modifyThreadName)
}

/**
 * Schedule generating session name and thread name (with dedup and delay)
 */
export function scheduleGenerateNameAndThreadName(sessionId: string) {
  const key = `name-${sessionId}`

  if (activeNameGenerations.has(key)) {
    return
  }

  const existingTimeout = pendingNameGenerations.get(key)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
  }

  const timeout = setTimeout(async () => {
    pendingNameGenerations.delete(key)
    activeNameGenerations.add(key)

    try {
      await generateNameAndThreadName(sessionId)
    } finally {
      activeNameGenerations.delete(key)
    }
  }, 1000)

  pendingNameGenerations.set(key, timeout)
}

/**
 * Schedule generating thread name (with dedup and delay)
 */
export function scheduleGenerateThreadName(sessionId: string) {
  const key = `thread-${sessionId}`

  if (activeNameGenerations.has(key)) {
    return
  }

  const existingTimeout = pendingNameGenerations.get(key)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
  }

  const timeout = setTimeout(async () => {
    pendingNameGenerations.delete(key)
    activeNameGenerations.add(key)

    try {
      await generateThreadName(sessionId)
    } finally {
      activeNameGenerations.delete(key)
    }
  }, 1000)

  pendingNameGenerations.set(key, timeout)
}
