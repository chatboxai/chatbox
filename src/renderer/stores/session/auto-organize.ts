import type { SessionGroup, SessionMeta } from '@shared/types'
import { createGroup } from '../groupStore'
import { moveSessionToGroup } from '../sessionActions'

export interface OrganizeProposal {
  moves: Array<{ sessionId: string; targetGroupId: string | null }>
  newGroups?: Array<{ tempId: string; name: string; parentId?: string | null }>
  rationale?: string
}

export interface OrganizeStrategy {
  generate(input: { groups: SessionGroup[]; sessions: SessionMeta[] }): Promise<OrganizeProposal>
}

// Default no-op strategy used as a placeholder until an LLM-backed one ships.
export const noOpStrategy: OrganizeStrategy = {
  generate: async () => ({ moves: [] }),
}

export async function applyProposal(p: OrganizeProposal): Promise<void> {
  const tempIdToReal = new Map<string, string>()
  for (const ng of p.newGroups ?? []) {
    const created = await createGroup({ name: ng.name, parentId: ng.parentId ?? null })
    tempIdToReal.set(ng.tempId, created.id)
  }
  for (const move of p.moves) {
    const target = move.targetGroupId
    const resolved = target && tempIdToReal.has(target) ? (tempIdToReal.get(target) ?? null) : target
    await moveSessionToGroup(move.sessionId, resolved)
  }
}
