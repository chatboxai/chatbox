import type { Session } from '@shared/types'
import { getWorkArtifacts } from '@shared/work-artifacts'
import { expect, it } from 'vitest'
import { collectSessionResourceReferences, restoreSessionResourceKeys } from './resources'

it('includes delivered work files in backup and remaps restored blob references', () => {
  const session: Session = {
    id: 'session',
    name: 'Work',
    messages: [
      {
        id: 'message',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            toolCallId: 'deliver',
            toolName: 'create_download',
            state: 'result',
            result: {
              artifacts: [
                {
                  path: 'artifacts/1/report.pptx',
                  name: 'report.pptx',
                  mimeType: 'application/octet-stream',
                  size: 100,
                  storageKey: 'file:original:raw',
                },
              ],
            },
          },
        ],
      },
    ],
  }
  expect(collectSessionResourceReferences(session).references).toContainEqual({
    storageKey: 'file:original:raw',
    kind: 'raw-attachment',
    sessionId: 'session',
    mimeType: 'application/octet-stream',
    filename: 'report.pptx',
  })
  const restored = restoreSessionResourceKeys(session, new Map([['file:original:raw', 'file:restored:raw']]))
  expect(getWorkArtifacts(restored.messages[0].contentParts[0])[0].storageKey).toBe('file:restored:raw')
  expect(getWorkArtifacts(session.messages[0].contentParts[0])[0].storageKey).toBe('file:original:raw')
})
