import type { Message, Session } from '../../types/session'
import type { encodeSessionTree } from './encode'

/** A message with this id makes the wrapped encoder reject its session. */
export const UNENCODABLE_MESSAGE_ID = 'unencodable'

export const UNENCODABLE_REASON = 'session holds an unencodable test message'

export function unencodableMessage(): Message {
  return { id: UNENCODABLE_MESSAGE_ID, role: 'assistant', contentParts: [{ type: 'text', text: 'Preserved text' }] }
}

function holdsMarker(session: Session): boolean {
  const lists = [
    session.messages,
    ...(session.threads ?? []).map((thread) => thread.messages),
    ...Object.values(session.messageForksHash ?? {}).flatMap((fork) => fork.lists.map((list) => list.messages)),
  ]
  return lists.some((messages) => messages.some((message) => message.id === UNENCODABLE_MESSAGE_ID))
}

/**
 * Repairs make every known V1 shape encodable. Tests of the legacy JSON
 * fallback wrap the encoder with this to reject a session carrying the marker.
 */
export function failOnUnencodableMarker(encode: typeof encodeSessionTree): typeof encodeSessionTree {
  return (session, options) =>
    holdsMarker(session) ? { ok: false, reason: UNENCODABLE_REASON } : encode(session, options)
}
