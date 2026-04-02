import '../setup'

import { describe, expect, it } from 'vitest'
import {
  ChatBridgeAppAuthGrantSchema,
  ChatBridgeStoryBuilderStateSchema,
  getChatBridgeStoryBuilderSummaryForModel,
} from '@shared/chatbridge'
import { createChatBridgeAuthBroker } from 'src/main/chatbridge/auth-broker'
import { createChatBridgeResourceProxy } from 'src/main/chatbridge/resource-proxy'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-story-builder-auth-resource',
      primaryFamily: 'auth-resource',
      evidenceFamilies: ['persistence'],
      legacy: true,
    },
    testCase,
    execute
  )
}

describe('ChatBridge Story Builder lifecycle', () => {
  function createGrant() {
    return ChatBridgeAppAuthGrantSchema.parse({
      schemaVersion: 1,
      grantId: 'grant-1',
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      permissionIds: ['drive.read', 'drive.write'],
      credentialHandle: 'grant-handle-1',
      status: 'granted',
      createdAt: 100,
      updatedAt: 120,
      expiresAt: 10_000,
    })
  }

  it('launches Story Builder, reads the latest draft, saves a checkpoint, and hands completion back to chat', () =>
    traceScenario(
      'launches Story Builder, reads the latest draft, saves a checkpoint, and hands completion back to chat',
      async () => {
        const broker = createChatBridgeAuthBroker({
          now: () => 500,
          createId: () => 'story-builder-handle-1',
        })
        const launch = broker.authorizeAppLaunch({
          userId: 'student-1',
          appId: 'story-builder',
          authMode: 'oauth',
          grants: [createGrant()],
          permissionIds: ['drive.read', 'drive.write'],
        })

        expect(launch).toMatchObject({
          authorized: true,
          grantedCapability: 'credential-handle',
        })
        if (!launch.authorized || !launch.credentialHandle) {
          return
        }

        const proxy = createChatBridgeResourceProxy({
          validator: broker,
          now: () => 550,
        })
        proxy.registerAction(
          {
            appId: 'story-builder',
            resource: 'drive',
            action: 'drive.readDraft',
            permissionId: 'drive.read',
            description: 'Read the latest Story Builder draft from Drive.',
            inputSchema: {
              type: 'object',
              properties: {
                draftId: { type: 'string' },
              },
              required: ['draftId'],
            },
          },
          ({ payload }) => ({
            draftId: payload.draftId,
            title: 'Storm Lantern',
            chapterLabel: 'Chapter 4',
            excerpt:
              'Mara tucked the lantern beneath the library desk and counted the sirens again before she dared to breathe.',
            checkpointId: 'draft-42',
          })
        )
        proxy.registerAction(
          {
            appId: 'story-builder',
            resource: 'drive',
            action: 'drive.saveDraft',
            permissionId: 'drive.write',
            description: 'Save the latest Story Builder draft through the host-managed proxy.',
            inputSchema: {
              type: 'object',
              properties: {
                draftId: { type: 'string' },
                wordCount: { type: 'number' },
              },
              required: ['draftId', 'wordCount'],
            },
          },
          ({ payload }) => ({
            draftId: payload.draftId,
            checkpointId: 'draft-43',
            savedAtLabel: 'Just now',
            wordCount: payload.wordCount,
          })
        )

        const readResponse = await proxy.execute({
          schemaVersion: 1,
          requestId: 'request-read-1',
          handleId: launch.credentialHandle.handleId,
          userId: 'student-1',
          appId: 'story-builder',
          resource: 'drive',
          action: 'drive.readDraft',
          payload: {
            draftId: 'draft-42',
          },
        })

        expect(readResponse).toMatchObject({
          status: 'success',
          result: {
            draftId: 'draft-42',
            checkpointId: 'draft-42',
          },
          audit: {
            outcome: 'granted',
            permissionId: 'drive.read',
          },
        })

        const activeState = ChatBridgeStoryBuilderStateSchema.parse({
          schemaVersion: 1,
          mode: 'active',
          drive: {
            provider: 'google-drive',
            status: 'connected',
            statusLabel: 'Drive connected',
            detail: 'Host-issued Drive access is active for the classroom writing folder.',
            connectedAs: 'student.writer@example.edu',
            folderLabel: 'Creative Writing / Chapter 4',
            lastSyncedLabel: 'Moments ago',
          },
          draft: {
            title: 'Storm Lantern',
            chapterLabel: 'Chapter 4',
            summary: 'Mara hides the storm lantern before the flood siren starts and the library doors lock.',
            excerpt: String(readResponse.result.excerpt),
            wordCount: 812,
            saveState: 'saved',
            saveLabel: 'Checkpoint ready in Drive',
          },
          checkpoints: [
            {
              checkpointId: String(readResponse.result.checkpointId),
              label: 'Checkpoint 42',
              description: 'Latest Drive-backed draft ready to resume.',
              savedAtLabel: 'Moments ago',
              status: 'latest',
              locationLabel: 'Creative Writing / Chapter 4',
            },
          ],
          callout: {
            eyebrow: 'Host guidance',
            title: 'Resume stays explicit',
            description: 'The host can reopen this checkpoint without exposing a raw Drive token to the app runtime.',
          },
        })

        const activeSummary = getChatBridgeStoryBuilderSummaryForModel(
          {
            appId: 'story-builder',
            appName: 'Story Builder',
          },
          activeState
        )
        expect(activeSummary).toContain('Story Builder is actively drafting Chapter 4.')
        expect(activeSummary).toContain('Checkpoint 42')

        const saveResponse = await proxy.execute({
          schemaVersion: 1,
          requestId: 'request-save-1',
          handleId: launch.credentialHandle.handleId,
          userId: 'student-1',
          appId: 'story-builder',
          resource: 'drive',
          action: 'drive.saveDraft',
          payload: {
            draftId: 'draft-42',
            wordCount: 1048,
          },
        })

        expect(saveResponse).toMatchObject({
          status: 'success',
          result: {
            checkpointId: 'draft-43',
            wordCount: 1048,
          },
          audit: {
            outcome: 'granted',
            permissionId: 'drive.write',
          },
        })

        const completionState = ChatBridgeStoryBuilderStateSchema.parse({
          schemaVersion: 1,
          mode: 'complete',
          drive: {
            provider: 'google-drive',
            status: 'connected',
            statusLabel: 'Drive synced',
            detail: 'The finished draft and checkpoint trail are saved in the host-approved Drive folder.',
            connectedAs: 'student.writer@example.edu',
            folderLabel: 'Creative Writing / Chapter 4',
            lastSyncedLabel: String(saveResponse.result.savedAtLabel),
          },
          draft: {
            title: 'Storm Lantern',
            chapterLabel: 'Chapter 4',
            summary: 'The completed chapter draft is back in chat with the latest checkpoint and next revision cue.',
            excerpt:
              'When the lights returned, Mara lifted the lantern from beneath the desk and saw her own reflection in the wet brass.',
            wordCount: Number(saveResponse.result.wordCount),
            saveState: 'saved',
            saveLabel: 'Final draft saved to Drive',
          },
          checkpoints: [
            {
              checkpointId: String(saveResponse.result.checkpointId),
              label: 'Final checkpoint',
              description: 'Completed chapter pass with resolved lantern reveal.',
              savedAtLabel: String(saveResponse.result.savedAtLabel),
              status: 'latest',
              locationLabel: 'Creative Writing / Chapter 4',
            },
          ],
          completion: {
            title: 'Draft returned to chat',
            description:
              'The host preserved the completed chapter, Drive save, and revision cue for the next conversation turn.',
            handoffLabel: 'Ask for revision notes or continue with chapter five.',
            nextStepLabel: 'Continue the writing session from the final checkpoint if you want another pass.',
          },
        })

        const completionSummary = getChatBridgeStoryBuilderSummaryForModel(
          {
            appId: 'story-builder',
            appName: 'Story Builder',
          },
          completionState
        )
        expect(completionSummary).toContain('Story Builder completed Chapter 4 and handed the draft back to chat.')
        expect(completionSummary).toContain('Ask for revision notes or continue with chapter five.')
      }
    ))

  it('fails closed when the credential handle expires before Story Builder can save and leaves a resumable host-owned state', () =>
    traceScenario(
      'fails closed when the credential handle expires before Story Builder can save and leaves a resumable host-owned state',
      async () => {
        let currentNow = 500
        const broker = createChatBridgeAuthBroker({
          now: () => currentNow,
          createId: () => 'story-builder-handle-1',
        })
        const launch = broker.authorizeAppLaunch({
          userId: 'student-1',
          appId: 'story-builder',
          authMode: 'oauth',
          grants: [createGrant()],
          permissionIds: ['drive.write'],
        })

        expect(launch.authorized).toBe(true)
        if (!launch.authorized || !launch.credentialHandle) {
          return
        }

        const proxy = createChatBridgeResourceProxy({
          validator: broker,
          now: () => currentNow,
        })
        proxy.registerAction(
          {
            appId: 'story-builder',
            resource: 'drive',
            action: 'drive.saveDraft',
            permissionId: 'drive.write',
            description: 'Save the latest Story Builder draft through the host-managed proxy.',
            inputSchema: {
              type: 'object',
              properties: {
                draftId: { type: 'string' },
              },
              required: ['draftId'],
            },
          },
          ({ payload }) => ({
            draftId: payload.draftId,
          })
        )

        currentNow = 1_000_000
        const denied = await proxy.execute({
          schemaVersion: 1,
          requestId: 'request-save-expired',
          handleId: launch.credentialHandle.handleId,
          userId: 'student-1',
          appId: 'story-builder',
          resource: 'drive',
          action: 'drive.saveDraft',
          payload: {
            draftId: 'draft-42',
          },
        })

        expect(denied).toMatchObject({
          status: 'denied',
          errorCode: 'expired-handle',
        })
        expect(JSON.stringify(denied)).not.toContain('accessToken')

        const resumeState = ChatBridgeStoryBuilderStateSchema.parse({
          schemaVersion: 1,
          mode: 'needs-auth',
          drive: {
            provider: 'google-drive',
            status: 'expired',
            statusLabel: 'Reconnect Drive',
            detail: 'Drive auth expired before the latest checkpoint could be saved.',
          },
          draft: {
            title: 'Storm Lantern',
            chapterLabel: 'Chapter 4',
            summary: 'The host kept the latest safe passage and is waiting to reconnect Drive.',
            excerpt:
              'Mara folded the page corner over the last safe paragraph and left the lantern hidden beneath the desk.',
            wordCount: 996,
            saveState: 'attention',
            saveLabel: 'Save blocked until Drive reconnects',
          },
          checkpoints: [
            {
              checkpointId: 'draft-42',
              label: 'Last safe checkpoint',
              description: 'Resumable checkpoint before the failed save attempt.',
              savedAtLabel: '18 minutes ago',
              status: 'attention',
            },
          ],
          callout: {
            eyebrow: 'Host guidance',
            title: 'Reconnect before saving',
            description: 'Resume stays possible because the host preserved the last safe checkpoint in-thread.',
          },
        })

        const summary = getChatBridgeStoryBuilderSummaryForModel(
          {
            appId: 'story-builder',
            appName: 'Story Builder',
          },
          resumeState
        )

        expect(summary).toContain('waiting for Google Drive authorization')
        expect(summary).toContain('Last safe checkpoint')
      }
    ))
})
