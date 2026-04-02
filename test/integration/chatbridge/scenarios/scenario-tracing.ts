import {
  CHATBRIDGE_LANGSMITH_PROJECT_NAME,
  createChatBridgeTraceMetadata,
  createChatBridgeTraceName,
  createChatBridgeTraceTags,
  type ChatBridgeTraceDescriptor,
} from '@shared/models/tracing'
import { getLangSmithErrorMessage } from '@shared/utils/langsmith_adapter'
import { createMainLangSmithAdapter } from 'src/main/adapters/langsmith'

const scenarioTraceAdapter = createMainLangSmithAdapter({
  projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME,
})

type ScenarioTraceDescriptor = Omit<ChatBridgeTraceDescriptor, 'surface'>

export async function runChatBridgeScenarioTrace<T>(
  descriptor: ScenarioTraceDescriptor,
  testCase: string,
  execute: () => Promise<T> | T
) {
  if (!scenarioTraceAdapter.enabled) {
    return await execute()
  }

  const traceDescriptor: ChatBridgeTraceDescriptor = {
    ...descriptor,
    surface: 'eval',
  }
  const run = await scenarioTraceAdapter.startRun({
    name: createChatBridgeTraceName(traceDescriptor),
    projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME,
    runType: 'chain',
    inputs: {
      testCase,
    },
    metadata: createChatBridgeTraceMetadata(traceDescriptor, {
      testCase,
    }),
    tags: createChatBridgeTraceTags(traceDescriptor, ['scenario-suite']),
  })

  try {
    const result = await execute()
    await run.end({
      outputs: {
        status: 'passed',
        testCase,
      },
    })
    return result
  } catch (error) {
    await run.end({
      error: getLangSmithErrorMessage(error),
      metadata: {
        testCase,
      },
    })
    throw error
  }
}
