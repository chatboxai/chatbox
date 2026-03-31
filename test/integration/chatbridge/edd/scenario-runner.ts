import { createChatBridgeTraceStepRunner } from './langsmith'
import {
  type ChatBridgeEvalEvent,
  writeChatBridgeEvalRecord,
} from './local-log'

type ScenarioStepRunner = <T>(
  name: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T> | T
) => Promise<T>

type ScenarioContext = {
  events: ChatBridgeEvalEvent[]
  record: (type: string, data?: Record<string, unknown>) => void
  step: ScenarioStepRunner
}

type RunScenarioOptions<T> = {
  scenarioId: string
  storyIds: string[]
  metadata?: Record<string, unknown>
  outputs?: (result: T) => Record<string, unknown>
  traceSteps?: boolean
  run: (context: ScenarioContext) => Promise<T>
}

export async function runChatBridgeEvalScenario<T>(options: RunScenarioOptions<T>) {
  const startedAt = new Date().toISOString()
  const events: ChatBridgeEvalEvent[] = []
  const traceStep = createChatBridgeTraceStepRunner({
    baseMetadata: {
      scenarioId: options.scenarioId,
      storyIds: options.storyIds,
      ...(options.metadata ?? {}),
    },
  })

  function record(type: string, data?: Record<string, unknown>) {
    events.push({
      type,
      at: new Date().toISOString(),
      ...(data ? { data } : {}),
    })
  }

  const step: ScenarioStepRunner = async (name, metadata, fn) => {
    record('step.started', {
      stepName: name,
      ...metadata,
    })

    try {
      const result =
        options.traceSteps === false
          ? await fn()
          : await traceStep(name, metadata, fn)
      record('step.completed', {
        stepName: name,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      record('step.failed', {
        stepName: name,
        error: message,
      })
      throw error
    }
  }

  record('scenario.started', {
    storyIds: options.storyIds,
  })

  try {
    const result = await options.run({
      events,
      record,
      step,
    })

    const finishedAt = new Date().toISOString()
    record('scenario.completed', {
      storyIds: options.storyIds,
    })

    const localLogPath = await writeChatBridgeEvalRecord({
      scenarioId: options.scenarioId,
      storyIds: options.storyIds,
      startedAt,
      finishedAt,
      metadata: options.metadata,
      outputs: options.outputs?.(result),
      events,
    })

    return {
      result,
      events,
      localLogPath,
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : String(error)

    record('scenario.failed', {
      error: message,
    })

    await writeChatBridgeEvalRecord({
      scenarioId: options.scenarioId,
      storyIds: options.storyIds,
      startedAt,
      finishedAt,
      metadata: options.metadata,
      error: message,
      events,
    })

    throw error
  }
}
