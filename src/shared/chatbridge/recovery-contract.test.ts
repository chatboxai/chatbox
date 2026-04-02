import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
  createChatBridgeHostTool,
  wrapChatBridgeHostTools,
} from './tools'
import {
  createChatBridgeBridgeRejectionRecoveryContract,
  createChatBridgeMalformedBridgeRecoveryContract,
  createChatBridgeRecoveryAuditEvent,
  createChatBridgeRuntimeCrashRecoveryContract,
  getChatBridgeRecoveryContractFromToolExecutionRecord,
  parseChatBridgeRecoveryContract,
  writeChatBridgeRecoveryContractValues,
} from './recovery-contract'

describe('chatbridge recovery contract', () => {
  it('classifies rejected host tool calls as bounded invalid-tool-call recoveries', async () => {
    const toolSet = wrapChatBridgeHostTools({
      save_story: createChatBridgeHostTool({
        description: 'Save the current story draft.',
        appId: 'story-builder',
        schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
        effect: 'side-effect',
        retryClassification: 'unsafe',
        inputSchema: z.object({
          title: z.string(),
          idempotencyKey: z.string().optional(),
        }),
        execute: async () => ({ saved: true }),
      }),
    })

    const result = await toolSet.save_story.execute?.({ title: 'Chapter Four' }, { toolCallId: 'tool-save', messages: [] })
    expect(result).toBeTruthy()

    const contract = getChatBridgeRecoveryContractFromToolExecutionRecord(result as never)
    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      failureClass: 'invalid-tool-call',
      source: 'tool',
      statusLabel: 'Invalid tool call',
      observability: {
        auditCategory: 'lifecycle.recovery',
        traceCode: 'recovery.invalid-tool-call',
      },
    })
    expect(contract?.actions.map((action) => action.id)).toEqual(['continue-in-chat', 'inspect-invalid-fields'])
  })

  it('builds malformed bridge-event recoveries that fail closed and preserve thread continuity', () => {
    const contract = createChatBridgeMalformedBridgeRecoveryContract({
      appId: 'debate-arena',
      appInstanceId: 'instance-1',
      bridgeSessionId: 'bridge-1',
      rawKind: 'app.state',
      issues: ['snapshot.round: Required', 'idempotencyKey: Required'],
    })

    expect(contract).toMatchObject({
      failureClass: 'malformed-bridge-event',
      source: 'bridge',
      severity: 'terminal',
      correlation: {
        appId: 'debate-arena',
        appInstanceId: 'instance-1',
        bridgeSessionId: 'bridge-1',
      },
    })
    expect(contract.observability.details).toEqual([
      'rawKind: app.state',
      'snapshot.round: Required',
      'idempotencyKey: Required',
    ])
  })

  it('maps session-expired bridge rejections into explicit timeout recoveries', () => {
    const contract = createChatBridgeBridgeRejectionRecoveryContract({
      appId: 'story-builder',
      reason: 'session-expired',
      event: {
        kind: 'app.ready',
        appInstanceId: 'instance-timeout',
        bridgeSessionId: 'bridge-timeout',
      },
    })

    expect(contract).toMatchObject({
      failureClass: 'timeout',
      source: 'bridge',
      statusLabel: 'Timed out',
      correlation: {
        appId: 'story-builder',
        appInstanceId: 'instance-timeout',
        bridgeSessionId: 'bridge-timeout',
      },
    })
  })

  it('serializes runtime-crash recoveries into values and recovery-aware audit events', () => {
    const contract = createChatBridgeRuntimeCrashRecoveryContract({
      appId: 'story-builder',
      appInstanceId: 'instance-crash',
      bridgeSessionId: 'bridge-crash',
      error: 'Worker process exited unexpectedly.',
      code: 'worker_exit',
    })

    const values = writeChatBridgeRecoveryContractValues(undefined, contract)
    expect(parseChatBridgeRecoveryContract(values.chatbridgeRecoveryContract)).toEqual(contract)

    const audit = createChatBridgeRecoveryAuditEvent({
      eventId: 'audit-recovery-1',
      occurredAt: 1_000,
      contract,
      sessionId: 'session-1',
    })

    expect(audit).toMatchObject({
      category: 'lifecycle.recovery',
      outcome: 'runtime_crash',
      appId: 'story-builder',
      sessionId: 'session-1',
      action: 'runtime-crash',
      summary: contract.summary,
    })
    expect(audit.details).toEqual(
      expect.arrayContaining(['code: worker_exit', 'error: Worker process exited unexpectedly.', 'failureClass: runtime-crash'])
    )
  })
})
