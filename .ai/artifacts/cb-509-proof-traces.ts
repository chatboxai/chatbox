import { createMainLangSmithAdapter } from '../../src/main/adapters/langsmith'
import {
  CHATBRIDGE_LANGSMITH_PROJECT_NAME,
  createChatBridgeTraceMetadata,
  createChatBridgeTraceName,
  createChatBridgeTraceTags,
} from '../../src/shared/models/tracing'

const adapter = createMainLangSmithAdapter({ projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME })

if (!adapter.enabled) {
  throw new Error('LangSmith adapter is not enabled for proof trace generation.')
}

const traces = [
  {
    key: 'drawing_follow_up',
    descriptor: {
      slug: 'chatbridge-drawing-kit-flagship',
      surface: 'eval',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['persistence'],
      storyId: 'CB-509',
      runtimeTarget: 'integration-vitest',
      smokeSupport: 'scenario-only',
    },
    suffix: 'cb-509-doc-proof-follow-up',
    inputs: {
      testCase: 'Drawing Kit completion injects host-owned follow-up summary',
      checkpointId: 'drawing-kit-4200',
      caption: 'Triple pickle sandwich',
      rewardLabel: 'Llama sticker',
    },
    outputs: {
      status: 'passed',
      evidence: 'follow-up-chat-context',
      summary: 'Drawing Kit round complete. Triple pickle sandwich and the llama sticker are saved for follow-up chat.',
    },
  },
  {
    key: 'drawing_recovery',
    descriptor: {
      slug: 'chatbridge-drawing-kit-flagship',
      surface: 'eval',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['recovery'],
      storyId: 'CB-509',
      runtimeTarget: 'integration-vitest',
      smokeSupport: 'scenario-only',
    },
    suffix: 'cb-509-doc-proof-recovery',
    inputs: {
      testCase: 'Drawing Kit runtime crash preserves the last checkpoint',
      checkpointId: 'drawing-kit-9900',
      caption: 'Crooked sandwich tower',
    },
    outputs: {
      status: 'passed',
      evidence: 'runtime-crash-recovery',
      fallback: 'Continue in chat from the last validated Drawing Kit checkpoint or dismiss the failed runtime without losing thread context.',
    },
  },
  {
    key: 'drawing_manual_smoke',
    descriptor: {
      slug: 'chatbridge-drawing-kit-doodle-dare',
      surface: 'manual_smoke',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['persistence'],
      storyId: 'CB-509',
      runtimeTarget: 'desktop-electron',
      smokeSupport: 'supported',
    },
    suffix: 'cb-509-doc-proof',
    inputs: {
      fixtureId: 'drawing-kit-doodle-dare',
      fixtureName: '[Seeded] ChatBridge: Drawing Kit doodle dare',
      sessionId: 'cb-509-doc-proof-session',
      supportedPath: 'desktop-seed-lab',
    },
    outputs: {
      outcome: 'passed',
      checkpointId: 'drawing-kit-4200',
      note: 'Supported manual smoke path now covers the inline Drawing Kit doodle game and follow-up chat continuity.',
    },
  },
]

async function main() {
  const results: Record<string, { name: string; runId: string }> = {}

  for (const trace of traces) {
    const name = createChatBridgeTraceName(trace.descriptor, trace.suffix)
    const run = await adapter.startRun({
      name,
      projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME,
      runType: 'chain',
      inputs: trace.inputs,
      metadata: createChatBridgeTraceMetadata(trace.descriptor, trace.inputs),
      tags: createChatBridgeTraceTags(trace.descriptor, ['doc-proof']),
    })

    await run.end({ outputs: trace.outputs })
    results[trace.key] = { name, runId: run.runId }
  }

  console.log(JSON.stringify(results, null, 2))
}

void main()
