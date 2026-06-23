import { type ToolSet, tool } from 'ai'
import z from 'zod'
import { type AttemptResult, concurrencyLadder, runWithConcurrencyFallback } from '@/lib/concurrency'
import * as chatStore from '@/stores/chatStore'
import * as groupStore from '@/stores/groupStore'
import { applyProposal, noOpStrategy, type OrganizeProposal } from '@/stores/session/auto-organize'
import { duplicateGroup } from '@/stores/session/groups'
import { generateSessionSummary, getSessionSummary } from '@/stores/session/summary'
import { _copySession, moveSessionToGroup, reorderGroups } from '@/stores/sessionActions'
import { settingsStore } from '@/stores/settingsStore'
import { getMessageText } from '../../../../shared/utils/message'

const toolSetDescription = `
Use these tools to organize the user's chat sidebar: list sessions/groups, move/rename/delete/duplicate them,
manage groups (including color, parent, and reordering), and propose auto-organization. Destructive operations
require user confirmation.

Prefer the bulk_* tools whenever you need to act on more than one session/group — calling per-item tools in
sequence is slow and noisy. To decide what to do with each session, use get_session_summary or
bulk_get_summaries (cached, generates on demand) before moving them; fall back to get_session_messages only
when summaries are inadequate.
`

export interface ConfirmDangerousActionInput {
  type: string
  description: string
}

export type ConfirmDangerousFn = (action: ConfirmDangerousActionInput) => Promise<boolean>

const declined = { skipped: true as const, reason: 'user_declined' as const }

// Read the COMPLETE session set straight from storage (getAll), never the paginated
// React-Query cache — the manager must see every session, not just the loaded pages.
async function loadVisibleSessions() {
  const list = await chatStore.listAllSessionsMeta()
  return list.filter((s) => !s.system)
}

type SummaryPayload = { summary: string; cached: boolean; stale: false; generatedAt: number }

// Read a cached summary (when fresh) or generate one. Resolves (never throws) to an AttemptResult
// so the concurrency-fallback runner can retry only the failed sessions at a lower concurrency.
async function summarizeSession(sessionId: string, forceRegenerate?: boolean): Promise<AttemptResult<SummaryPayload>> {
  const session = await chatStore.getSession(sessionId)
  if (!session) return { ok: false, error: 'session not found' }
  try {
    const read = await getSessionSummary(sessionId)
    if (read.cached && !read.stale && !forceRegenerate) {
      return {
        ok: true,
        result: { summary: read.cached.content, cached: true, stale: false, generatedAt: read.cached.generatedAt },
      }
    }
    const fresh = await generateSessionSummary(sessionId)
    return { ok: true, result: { summary: fresh.content, cached: false, stale: false, generatedAt: fresh.generatedAt } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function buildSessionManagerToolset(opts: { confirmDangerous: ConfirmDangerousFn }): {
  description: string
  tools: ToolSet
} {
  const { confirmDangerous } = opts

  const list_sessions = tool({
    description:
      'List ALL chat sessions visible in the sidebar (complete — never paginated or truncated). ' +
      'Optional filter by name substring or groupId. Returns total (matched), totalVisible (all), and per-session id/name/groupId/starred.',
    inputSchema: z.object({
      query: z.string().optional().describe('Case-insensitive substring of session name.'),
      groupId: z.string().optional().describe('Restrict to sessions in this group id (exact match).'),
    }),
    execute: async (input: { query?: string; groupId?: string }) => {
      const sessions = await loadVisibleSessions()
      const q = input.query?.trim().toLowerCase()
      const filtered = sessions.filter((s) => {
        if (input.groupId !== undefined && (s.groupId ?? null) !== input.groupId) return false
        if (q && !s.name.toLowerCase().includes(q)) return false
        return true
      })
      return {
        ok: true,
        complete: true,
        total: filtered.length,
        totalVisible: sessions.length,
        sessions: filtered.map((s) => ({
          id: s.id,
          name: s.name,
          groupId: s.groupId ?? null,
          starred: s.starred ?? false,
          sortIndex: s.sortIndex ?? null,
        })),
      }
    },
  })

  const list_groups = tool({
    description:
      'List ALL sidebar groups with id, name, parentId, color, sortIndex, and sessionCount (direct sessions in ' +
      'that group, excluding sub-groups). Also returns totalSessions, ungroupedCount, and groupCount for the whole sidebar.',
    inputSchema: z.object({}),
    execute: async () => {
      const groups = await groupStore.listGroups()
      const sessions = await loadVisibleSessions()
      const directCount = new Map<string | null, number>()
      for (const s of sessions) {
        const k = s.groupId ?? null
        directCount.set(k, (directCount.get(k) ?? 0) + 1)
      }
      return {
        ok: true,
        totalSessions: sessions.length,
        ungroupedCount: directCount.get(null) ?? 0,
        groupCount: groups.length,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          parentId: g.parentId,
          color: g.color ?? null,
          sortIndex: g.sortIndex,
          sessionCount: directCount.get(g.id) ?? 0,
        })),
      }
    },
  })

  const move_session = tool({
    description: 'Move a session into a target group, or to ungrouped when targetGroupId is null.',
    inputSchema: z.object({
      sessionId: z.string(),
      targetGroupId: z.string().nullable(),
      insertIndex: z.number().int().min(0).optional(),
    }),
    execute: async (input: { sessionId: string; targetGroupId: string | null; insertIndex?: number }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      await moveSessionToGroup(input.sessionId, input.targetGroupId, input.insertIndex)
      return { ok: true }
    },
  })

  const rename_session = tool({
    description: 'Rename a session.',
    inputSchema: z.object({ sessionId: z.string(), newName: z.string().min(1) }),
    execute: async (input: { sessionId: string; newName: string }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      await chatStore.updateSession(input.sessionId, (s) => {
        if (!s) throw new Error('session not found')
        return { ...s, name: input.newName }
      })
      return { ok: true }
    },
  })

  const duplicate_session = tool({
    description: 'Duplicate a session (messages copied). Returns the new session id.',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (input: { sessionId: string }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      const sessions = await chatStore.listAllSessionsMeta()
      const meta = sessions.find((s) => s.id === input.sessionId)
      if (!meta) return { ok: false, error: 'session not found' }
      const created = await _copySession(meta)
      return { ok: true, newSessionId: created.id }
    },
  })

  const create_group = tool({
    description: 'Create a new sidebar group. Optional parentId (groups may nest up to 4 levels deep) and hex color.',
    inputSchema: z.object({
      name: z.string().min(1),
      parentId: z.string().nullable().optional(),
      color: z.string().optional(),
    }),
    execute: async (input: { name: string; parentId?: string | null; color?: string }) => {
      try {
        const group = await groupStore.createGroup({
          name: input.name,
          parentId: input.parentId ?? null,
          color: input.color,
        })
        return { ok: true, group }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const rename_group = tool({
    description: 'Rename a group.',
    inputSchema: z.object({ groupId: z.string(), newName: z.string().min(1) }),
    execute: async (input: { groupId: string; newName: string }) => {
      const groups = await groupStore.listGroups()
      if (!groups.find((g) => g.id === input.groupId)) return { ok: false, error: 'group not found' }
      try {
        await groupStore.updateGroup(input.groupId, { name: input.newName })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const reorder_group = tool({
    description: 'Reorder a group by setting its position in the sorted group list.',
    inputSchema: z.object({ groupId: z.string(), newSortIndex: z.number().int().min(0) }),
    execute: async (input: { groupId: string; newSortIndex: number }) => {
      const groups = await groupStore.listGroups()
      const sorted = [...groups].sort((a, b) => a.sortIndex - b.sortIndex)
      const currentIndex = sorted.findIndex((g) => g.id === input.groupId)
      if (currentIndex < 0) return { ok: false, error: 'group not found' }
      const target = Math.min(Math.max(input.newSortIndex, 0), sorted.length - 1)
      await reorderGroups(currentIndex, target)
      return { ok: true }
    },
  })

  const duplicate_group = tool({
    description: 'Duplicate a group, including its sessions and direct child groups.',
    inputSchema: z.object({ groupId: z.string() }),
    execute: async (input: { groupId: string }) => {
      try {
        const created = await duplicateGroup(input.groupId)
        return { ok: true, group: created }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const set_group_color = tool({
    description: 'Set or clear a group color. Pass empty string or null to reset to default.',
    inputSchema: z.object({ groupId: z.string(), color: z.string().nullable() }),
    execute: async (input: { groupId: string; color: string | null }) => {
      const groups = await groupStore.listGroups()
      if (!groups.find((g) => g.id === input.groupId)) return { ok: false, error: 'group not found' }
      try {
        await groupStore.updateGroup(input.groupId, { color: input.color ? input.color : undefined })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const set_group_parent = tool({
    description: 'Set or clear a group parent (groups may nest up to 4 levels deep). Pass null to un-nest.',
    inputSchema: z.object({ groupId: z.string(), parentId: z.string().nullable() }),
    execute: async (input: { groupId: string; parentId: string | null }) => {
      const groups = await groupStore.listGroups()
      if (!groups.find((g) => g.id === input.groupId)) return { ok: false, error: 'group not found' }
      try {
        await groupStore.updateGroup(input.groupId, { parentId: input.parentId })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const bulk_move = tool({
    description: 'Move many sessions into a single group (or null for ungrouped).',
    inputSchema: z.object({
      sessionIds: z.array(z.string()).min(1),
      targetGroupId: z.string().nullable(),
    }),
    execute: async (input: { sessionIds: string[]; targetGroupId: string | null }) => {
      const moved: string[] = []
      const failed: Array<{ sessionId: string; error: string }> = []
      for (const id of input.sessionIds) {
        try {
          const session = await chatStore.getSession(id)
          if (!session) {
            failed.push({ sessionId: id, error: 'session not found' })
            continue
          }
          await moveSessionToGroup(id, input.targetGroupId)
          moved.push(id)
        } catch (err) {
          failed.push({ sessionId: id, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { ok: failed.length === 0, moved, failed }
    },
  })

  const delete_session = tool({
    description: 'Permanently delete a session. Requires user confirmation.',
    inputSchema: z.object({ sessionId: z.string() }),
    execute: async (input: { sessionId: string }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      const ok = await confirmDangerous({
        type: 'delete_session',
        description: `Delete session "${session.name}"? This cannot be undone.`,
      })
      if (!ok) return declined
      await chatStore.deleteSession(input.sessionId)
      return { ok: true }
    },
  })

  const delete_group = tool({
    description: 'Permanently delete a group; sessions inside it become ungrouped. Requires user confirmation.',
    inputSchema: z.object({ groupId: z.string() }),
    execute: async (input: { groupId: string }) => {
      const groups = await groupStore.listGroups()
      const target = groups.find((g) => g.id === input.groupId)
      if (!target) return { ok: false, error: 'group not found' }
      const ok = await confirmDangerous({
        type: 'delete_group',
        description: `Delete group "${target.name}"? Sessions inside become ungrouped. This cannot be undone.`,
      })
      if (!ok) return declined
      await groupStore.deleteGroup(input.groupId)
      return { ok: true }
    },
  })

  const bulk_rename_sessions = tool({
    description: 'Rename many sessions in one call. Each item is { sessionId, newName }. Returns per-item ok/error.',
    inputSchema: z.object({
      items: z.array(z.object({ sessionId: z.string(), newName: z.string().min(1) })).min(1),
    }),
    execute: async (input: { items: Array<{ sessionId: string; newName: string }> }) => {
      const ok: string[] = []
      const failed: Array<{ sessionId: string; error: string }> = []
      for (const item of input.items) {
        try {
          const session = await chatStore.getSession(item.sessionId)
          if (!session) {
            failed.push({ sessionId: item.sessionId, error: 'session not found' })
            continue
          }
          await chatStore.updateSession(item.sessionId, (s) => {
            if (!s) throw new Error('session not found')
            return { ...s, name: item.newName }
          })
          ok.push(item.sessionId)
        } catch (err) {
          failed.push({ sessionId: item.sessionId, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { ok: failed.length === 0, renamed: ok, failed }
    },
  })

  const bulk_delete_sessions = tool({
    description:
      'Permanently delete many sessions in one call. Single confirmation covers the whole batch. Requires user confirmation.',
    inputSchema: z.object({ sessionIds: z.array(z.string()).min(1) }),
    execute: async (input: { sessionIds: string[] }) => {
      const sessions = await loadVisibleSessions()
      const targets = input.sessionIds
        .map((id) => sessions.find((s) => s.id === id))
        .filter((s): s is (typeof sessions)[number] => Boolean(s))
      if (targets.length === 0) return { ok: false, error: 'no matching sessions' }
      const preview = targets
        .slice(0, 6)
        .map((s) => `"${s.name}"`)
        .join(', ')
      const more = targets.length > 6 ? ` and ${targets.length - 6} more` : ''
      const ok = await confirmDangerous({
        type: 'bulk_delete_sessions',
        description: `Delete ${targets.length} session(s): ${preview}${more}? This cannot be undone.`,
      })
      if (!ok) return declined
      const deleted: string[] = []
      const failed: Array<{ sessionId: string; error: string }> = []
      for (const s of targets) {
        try {
          await chatStore.deleteSession(s.id)
          deleted.push(s.id)
        } catch (err) {
          failed.push({ sessionId: s.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { ok: failed.length === 0, deleted, failed }
    },
  })

  const bulk_update_groups = tool({
    description:
      'Update many groups in one call. Each item is { groupId, name?, color?, parentId? } — pass only fields you want to change. parentId=null un-nests; color="" or null clears.',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            groupId: z.string(),
            name: z.string().min(1).optional(),
            color: z.string().nullable().optional(),
            parentId: z.string().nullable().optional(),
          })
        )
        .min(1),
    }),
    execute: async (input: {
      items: Array<{
        groupId: string
        name?: string
        color?: string | null
        parentId?: string | null
      }>
    }) => {
      const groups = await groupStore.listGroups()
      const updated: string[] = []
      const failed: Array<{ groupId: string; error: string }> = []
      for (const item of input.items) {
        if (!groups.find((g) => g.id === item.groupId)) {
          failed.push({ groupId: item.groupId, error: 'group not found' })
          continue
        }
        const patch: { name?: string; color?: string | undefined; parentId?: string | null } = {}
        if (item.name !== undefined) patch.name = item.name
        if (item.color !== undefined) patch.color = item.color ? item.color : undefined
        if (item.parentId !== undefined) patch.parentId = item.parentId
        if (Object.keys(patch).length === 0) {
          failed.push({ groupId: item.groupId, error: 'no fields to update' })
          continue
        }
        try {
          await groupStore.updateGroup(item.groupId, patch)
          updated.push(item.groupId)
        } catch (err) {
          failed.push({ groupId: item.groupId, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { ok: failed.length === 0, updated, failed }
    },
  })

  const bulk_create_groups = tool({
    description:
      'Create many groups in one call. Each item is { name, parentId?, color? }. Returns the new group ids in input order so the caller can chain them with bulk_move/bulk_update_groups.',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            name: z.string().min(1),
            parentId: z.string().nullable().optional(),
            color: z.string().optional(),
          })
        )
        .min(1),
    }),
    execute: async (input: { items: Array<{ name: string; parentId?: string | null; color?: string }> }) => {
      const created: Array<{ name: string; group: Awaited<ReturnType<typeof groupStore.createGroup>> }> = []
      const failed: Array<{ name: string; error: string }> = []
      for (const item of input.items) {
        try {
          const g = await groupStore.createGroup({
            name: item.name,
            parentId: item.parentId ?? null,
            color: item.color,
          })
          created.push({ name: item.name, group: g })
        } catch (err) {
          failed.push({ name: item.name, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { ok: failed.length === 0, created, failed }
    },
  })

  const apply_organize_proposal = tool({
    description: 'Apply an auto-organize proposal: create new groups and move sessions. Requires user confirmation.',
    inputSchema: z.object({
      proposal: z.object({
        moves: z.array(z.object({ sessionId: z.string(), targetGroupId: z.string().nullable() })),
        newGroups: z
          .array(
            z.object({
              tempId: z.string(),
              name: z.string(),
              parentId: z.string().nullable().optional(),
            })
          )
          .optional(),
        rationale: z.string().optional(),
      }),
    }),
    execute: async (input: { proposal: OrganizeProposal }) => {
      const moves = input.proposal.moves.length
      const adds = input.proposal.newGroups?.length ?? 0
      const ok = await confirmDangerous({
        type: 'apply_organize_proposal',
        description: `Apply auto-organize: ${moves} session move(s), ${adds} new group(s). This cannot be undone.`,
      })
      if (!ok) return declined
      try {
        await applyProposal(input.proposal)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const auto_organize = tool({
    description:
      'Generate an auto-organize proposal (no changes applied). Review the result, then call apply_organize_proposal to commit.',
    inputSchema: z.object({}),
    execute: async () => {
      const groups = await groupStore.listGroups()
      const sessions = await loadVisibleSessions()
      const proposal = await noOpStrategy.generate({ groups, sessions })
      return { ok: true, proposal }
    },
  })

  const get_session_summary = tool({
    description:
      'Read a cached session summary, generating one on demand if missing or stale. Use this (and bulk_get_summaries) to decide where a session should go before moving it.',
    inputSchema: z.object({
      sessionId: z.string(),
      forceRegenerate: z.boolean().optional().describe('Regenerate even if a fresh cached summary exists.'),
    }),
    execute: async (input: { sessionId: string; forceRegenerate?: boolean }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      try {
        const read = await getSessionSummary(input.sessionId)
        if (read.cached && !read.stale && !input.forceRegenerate) {
          return {
            ok: true,
            sessionId: input.sessionId,
            summary: read.cached.content,
            cached: true,
            stale: false,
            generatedAt: read.cached.generatedAt,
          }
        }
        const fresh = await generateSessionSummary(input.sessionId)
        return {
          ok: true,
          sessionId: input.sessionId,
          summary: fresh.content,
          cached: false,
          stale: false,
          generatedAt: fresh.generatedAt,
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  const get_session_messages = tool({
    description:
      'Read the last N messages of a session as plain text — fallback when summaries are inadequate. Defaults to 5 messages, max 20. Returns truncated text per message (system messages skipped).',
    inputSchema: z.object({
      sessionId: z.string(),
      limit: z.number().int().min(1).max(20).optional(),
      perMessageCharLimit: z.number().int().min(50).max(4000).optional(),
    }),
    execute: async (input: { sessionId: string; limit?: number; perMessageCharLimit?: number }) => {
      const session = await chatStore.getSession(input.sessionId)
      if (!session) return { ok: false, error: 'session not found' }
      const limit = input.limit ?? 5
      const charLimit = input.perMessageCharLimit ?? 800
      const visible = session.messages.filter((m) => m.role !== 'system')
      const tail = visible.slice(-limit)
      const messages = tail.map((m) => {
        const text = getMessageText(m, false, false)
        return {
          role: m.role,
          text: text.length > charLimit ? `${text.slice(0, charLimit)}…` : text,
          truncated: text.length > charLimit,
        }
      })
      return {
        ok: true,
        sessionId: input.sessionId,
        sessionName: session.name,
        totalVisibleMessages: visible.length,
        returned: messages.length,
        messages,
      }
    },
  })

  const bulk_get_summaries = tool({
    description:
      'Read or generate summaries for many sessions at once. Runs in parallel (configurable via ' +
      'Settings → Default Models → Summary Concurrency, default 10) and auto-falls back 10 → 3 → 1 on ' +
      'repeated failures, keeping partial successes. Returns per-session ok/error. Prefer this over ' +
      'calling get_session_summary in a loop.',
    inputSchema: z.object({
      sessionIds: z.array(z.string()).min(1).max(100),
      forceRegenerate: z.boolean().optional(),
    }),
    execute: async (input: { sessionIds: string[]; forceRegenerate?: boolean }) => {
      const configured = settingsStore.getState().getSettings().summaryConcurrency ?? 10
      const ladder = concurrencyLadder(configured)
      const attempts = await runWithConcurrencyFallback(input.sessionIds, ladder, (id) =>
        summarizeSession(id, input.forceRegenerate)
      )
      const results = attempts.map((a) =>
        a.ok && a.result
          ? {
              sessionId: a.id,
              ok: true,
              summary: a.result.summary,
              cached: a.result.cached,
              stale: a.result.stale,
              generatedAt: a.result.generatedAt,
            }
          : { sessionId: a.id, ok: false, error: a.error }
      )
      const okCount = results.filter((r) => r.ok).length
      return { ok: okCount === results.length, total: results.length, okCount, concurrency: ladder, results }
    },
  })

  return {
    description: toolSetDescription,
    tools: {
      list_sessions,
      list_groups,
      move_session,
      rename_session,
      duplicate_session,
      create_group,
      rename_group,
      reorder_group,
      duplicate_group,
      set_group_color,
      set_group_parent,
      bulk_move,
      bulk_rename_sessions,
      bulk_delete_sessions,
      bulk_update_groups,
      bulk_create_groups,
      get_session_summary,
      get_session_messages,
      bulk_get_summaries,
      delete_session,
      delete_group,
      apply_organize_proposal,
      auto_organize,
    },
  }
}
