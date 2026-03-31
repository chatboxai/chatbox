import { z } from 'zod'
import type { BridgeAppEvent } from '@shared/chatbridge/bridge-session'
import {
  applyChatBridgeAppEvent,
  type ChatBridgeAppEvent,
  type ChatBridgeAppEventTransitionReason,
  ChatBridgeAppEventSchema,
  createChatBridgeAppEvent,
  normalizeBridgeAppEventToChatBridgeAppEvent,
} from '@shared/chatbridge/events'
import {
  type ChatBridgeAppInstance,
  ChatBridgeAppInstanceSchema,
  createChatBridgeAppInstance,
  type CreateChatBridgeAppInstanceInput,
} from '@shared/chatbridge/instance'

type RecordsStateInput = {
  instances?: ChatBridgeAppInstance[]
  events?: ChatBridgeAppEvent[]
}

type CreateChatBridgeAppRecordStoreOptions = {
  now?: () => number
  createId?: () => string
  snapshot?: RecordsStateInput
}

export type ChatBridgeAppRecordMutationReason =
  | 'missing-app-instance'
  | 'duplicate-event-id'
  | ChatBridgeAppEventTransitionReason

export type ChatBridgeAppRecordMutationResult =
  | {
      accepted: true
      state: ChatBridgeAppRecordState
      instance: ChatBridgeAppInstance
      event: ChatBridgeAppEvent
    }
  | {
      accepted: false
      reason: ChatBridgeAppRecordMutationReason
      state: ChatBridgeAppRecordState
      instance?: ChatBridgeAppInstance
      event?: ChatBridgeAppEvent
    }

export type ChatBridgeAppRecordState = {
  instances: Record<string, ChatBridgeAppInstance>
  eventsByInstanceId: Record<string, ChatBridgeAppEvent[]>
}

export const ChatBridgeAppRecordSnapshotSchema = z.object({
  instances: z.array(ChatBridgeAppInstanceSchema),
  events: z.array(ChatBridgeAppEventSchema),
})

export type ChatBridgeAppRecordSnapshot = z.infer<typeof ChatBridgeAppRecordSnapshotSchema>

function defaultCreateId() {
  return crypto.randomUUID()
}

function createEmptyState(): ChatBridgeAppRecordState {
  return {
    instances: {},
    eventsByInstanceId: {},
  }
}

function groupEvents(events: ChatBridgeAppEvent[]) {
  const grouped: Record<string, ChatBridgeAppEvent[]> = {}

  for (const event of events) {
    const bucket = grouped[event.appInstanceId] ?? []
    bucket.push(event)
    grouped[event.appInstanceId] = bucket
  }

  for (const bucket of Object.values(grouped)) {
    bucket.sort((left, right) => left.sequence - right.sequence)
  }

  return grouped
}

export function createChatBridgeAppRecordSnapshot(state: ChatBridgeAppRecordState): ChatBridgeAppRecordSnapshot {
  const events = Object.values(state.eventsByInstanceId)
    .flat()
    .sort((left, right) => {
      if (left.appInstanceId === right.appInstanceId) {
        return left.sequence - right.sequence
      }
      return left.appInstanceId.localeCompare(right.appInstanceId)
    })

  return ChatBridgeAppRecordSnapshotSchema.parse({
    instances: Object.values(state.instances).sort((left, right) => left.id.localeCompare(right.id)),
    events,
  })
}

export function hydrateChatBridgeAppRecordState(input: RecordsStateInput = {}) {
  const snapshot = ChatBridgeAppRecordSnapshotSchema.parse({
    instances: input.instances ?? [],
    events: input.events ?? [],
  })

  const state = createEmptyState()
  state.instances = Object.fromEntries(snapshot.instances.map((instance) => [instance.id, instance]))
  state.eventsByInstanceId = groupEvents(snapshot.events)

  for (const [instanceId, events] of Object.entries(state.eventsByInstanceId)) {
    const instance = state.instances[instanceId]
    if (!instance) {
      throw new Error(`Cannot hydrate ChatBridge app records without instance ${instanceId}.`)
    }

    let lastSequence = 0
    for (const event of events) {
      if (event.sequence <= lastSequence) {
        throw new Error(`ChatBridge app events for ${instanceId} must have strictly increasing sequences.`)
      }
      lastSequence = event.sequence
    }

    const lastEvent = events.at(-1)
    if (lastEvent && lastEvent.sequence !== instance.lastEventSequence) {
      throw new Error(`Hydrated ChatBridge instance ${instanceId} is out of sync with its latest event sequence.`)
    }
    if (lastEvent && lastEvent.nextStatus !== instance.status) {
      throw new Error(`Hydrated ChatBridge instance ${instanceId} is out of sync with its latest event status.`)
    }
  }

  return state
}

export function upsertChatBridgeAppInstance(state: ChatBridgeAppRecordState, instance: ChatBridgeAppInstance) {
  return {
    ...state,
    instances: {
      ...state.instances,
      [instance.id]: ChatBridgeAppInstanceSchema.parse(instance),
    },
  }
}

export function selectChatBridgeAppEvents(state: ChatBridgeAppRecordState, appInstanceId: string) {
  return [...(state.eventsByInstanceId[appInstanceId] ?? [])]
}

export function selectLatestChatBridgeAppEvent(state: ChatBridgeAppRecordState, appInstanceId: string) {
  return state.eventsByInstanceId[appInstanceId]?.at(-1) ?? null
}

export function selectActiveChatBridgeAppInstance(state: ChatBridgeAppRecordState) {
  return Object.values(state.instances)
    .filter((instance) => instance.status === 'launching' || instance.status === 'ready' || instance.status === 'active')
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
}

export function selectResumableChatBridgeAppInstances(state: ChatBridgeAppRecordState) {
  return Object.values(state.instances)
    .filter(
      (instance) =>
        instance.resumability.mode !== 'not-resumable' &&
        (instance.status === 'error' || instance.status === 'stale')
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function appendChatBridgeAppEvent(state: ChatBridgeAppRecordState, event: ChatBridgeAppEvent): ChatBridgeAppRecordMutationResult {
  const parsedEvent = ChatBridgeAppEventSchema.parse(event)
  const instance = state.instances[parsedEvent.appInstanceId]

  if (!instance) {
    return {
      accepted: false,
      reason: 'missing-app-instance',
      state,
      event: parsedEvent,
    }
  }

  const existingEvents = state.eventsByInstanceId[parsedEvent.appInstanceId] ?? []
  if (existingEvents.some((existing) => existing.id === parsedEvent.id)) {
    return {
      accepted: false,
      reason: 'duplicate-event-id',
      state,
      event: parsedEvent,
      instance,
    }
  }

  const transition = applyChatBridgeAppEvent(instance, parsedEvent)
  if (!transition.accepted) {
    return {
      accepted: false,
      reason: transition.reason,
      state,
      event: parsedEvent,
      instance,
    }
  }

  const nextState: ChatBridgeAppRecordState = {
    instances: {
      ...state.instances,
      [transition.instance.id]: transition.instance,
    },
    eventsByInstanceId: {
      ...state.eventsByInstanceId,
      [parsedEvent.appInstanceId]: [...existingEvents, parsedEvent],
    },
  }

  return {
    accepted: true,
    state: nextState,
    instance: transition.instance,
    event: parsedEvent,
  }
}

export function createChatBridgeAppRecordStore(options: CreateChatBridgeAppRecordStoreOptions = {}) {
  const createId = options.createId ?? defaultCreateId
  const now = options.now ?? Date.now

  let state = hydrateChatBridgeAppRecordState(options.snapshot)

  function nextSequence(appInstanceId: string) {
    return (state.instances[appInstanceId]?.lastEventSequence ?? 0) + 1
  }

  function recordEvent(
    input: Omit<ChatBridgeAppEvent, 'schemaVersion' | 'sequence' | 'createdAt' | 'id'> & {
      id?: string
      createdAt?: number
    }
  ) {
    const event = createChatBridgeAppEvent({
      ...input,
      id: input.id ?? createId(),
      sequence: nextSequence(input.appInstanceId),
      createdAt: input.createdAt ?? now(),
    })

    const result = appendChatBridgeAppEvent(state, event)
    if (result.accepted) {
      state = result.state
    }
    return result
  }

  return {
    getState() {
      return state
    },
    createInstance(input: CreateChatBridgeAppInstanceInput) {
      const baseInstance = createChatBridgeAppInstance(input, {
        now,
      })

      state = upsertChatBridgeAppInstance(state, baseInstance)

      const creationResult = recordEvent({
        id: createId(),
        appInstanceId: baseInstance.id,
        kind: 'instance.created',
        actor: 'host',
        nextStatus: 'launching',
        bridgeSessionId: baseInstance.bridgeSessionId,
        payload: {
          initiatedBy: baseInstance.owner.initiatedBy,
        },
      })

      if (!creationResult.accepted) {
        throw new Error(`Failed to initialize ChatBridge app instance ${baseInstance.id}: ${creationResult.reason}`)
      }

      return creationResult.instance
    },
    recordHostEvent(
      input: Omit<ChatBridgeAppEvent, 'schemaVersion' | 'sequence' | 'createdAt' | 'actor' | 'id'> & {
        id?: string
        actor?: 'host' | 'system'
        createdAt?: number
      }
    ) {
      return recordEvent({
        ...input,
        actor: input.actor ?? 'host',
      })
    },
    recordBridgeEvent(event: BridgeAppEvent, createdAt?: number) {
      const instance = state.instances[event.appInstanceId]
      if (!instance) {
        return {
          accepted: false as const,
          reason: 'missing-app-instance' as const,
          state,
        }
      }

      const normalized = normalizeBridgeAppEventToChatBridgeAppEvent(event, {
        id: createId(),
        sequence: nextSequence(instance.id),
        createdAt: createdAt ?? now(),
      })

      const result = appendChatBridgeAppEvent(state, normalized)
      if (result.accepted) {
        state = result.state
      }
      return result
    },
    getInstance(appInstanceId: string) {
      return state.instances[appInstanceId] ?? null
    },
    getEvents(appInstanceId: string) {
      return selectChatBridgeAppEvents(state, appInstanceId)
    },
    selectActiveInstance() {
      return selectActiveChatBridgeAppInstance(state)
    },
    selectResumableInstances() {
      return selectResumableChatBridgeAppInstances(state)
    },
    snapshot() {
      return createChatBridgeAppRecordSnapshot(state)
    },
    hydrate(snapshot: RecordsStateInput) {
      state = hydrateChatBridgeAppRecordState(snapshot)
      return state
    },
  }
}
