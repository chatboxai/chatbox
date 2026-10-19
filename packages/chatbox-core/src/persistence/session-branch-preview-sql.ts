import type { SessionBranchPreview, SessionBranchPreviewRequest } from '../ports/session-branch-source'
import type { SessionRowCommit } from '../ports/session-row-store'
import { assertBranchPreviewRevision, validateBranchPreviewRequest } from './session-branch-preview'
import type { SessionRowSqlBindValue, SessionRowSqlDatabase } from './session-row-sql'

/** Path identities stay in SQLite; only preview identities and scalar statistics cross the driver. */
const BRANCH_PREVIEW_SQL = `WITH RECURSIVE
  first AS (
    SELECT session_id,thread_id,message_id,parent_message_id,active_child_id,seq,kind,status,created_at,updated_at,branch_id,row_metadata_json
      FROM session_messages WHERE session_id=? AND message_id=?
  ),
  reachable(message_id) AS (
    SELECT message_id FROM first
    UNION
    SELECT m.active_child_id FROM reachable p CROSS JOIN first f
      JOIN session_messages m ON m.session_id=f.session_id AND m.thread_id=f.thread_id AND m.message_id=p.message_id
      WHERE m.active_child_id IS NOT NULL
  ),
  ordered(message_id,parent_message_id,active_child_id,thread_id,seq,kind,status,created_at,updated_at,branch_id,row_metadata_json,depth,broken_parent) AS (
    SELECT message_id,parent_message_id,active_child_id,thread_id,seq,kind,status,created_at,updated_at,branch_id,row_metadata_json,0,0 FROM first
    UNION ALL
    SELECT m.message_id,m.parent_message_id,m.active_child_id,m.thread_id,m.seq,m.kind,m.status,m.created_at,m.updated_at,m.branch_id,m.row_metadata_json,p.depth+1,
      m.parent_message_id IS NOT p.message_id
    FROM ordered p CROSS JOIN first f
      JOIN session_messages m ON m.session_id=f.session_id AND m.thread_id=f.thread_id AND m.message_id=p.active_child_id
    WHERE p.depth+1<(SELECT COUNT(*) FROM reachable)
  ),
  facts AS (
    SELECT *,
      CASE WHEN json_valid(row_metadata_json) THEN json_extract(row_metadata_json,'$.facts.role') END AS role,
      CASE WHEN json_valid(row_metadata_json) THEN COALESCE(json_extract(row_metadata_json,'$.facts.isForkMarker'),0) END AS marker,
      CASE WHEN json_valid(row_metadata_json)
        THEN json_type(row_metadata_json,'$.facts')='object'
          AND json_type(row_metadata_json,'$.facts.role')='text'
          AND json_type(row_metadata_json,'$.selected') IN ('true','false')
        ELSE 0 END AS projection_ready
    FROM ordered
  ),
  head AS (
    SELECT message_id,role,depth FROM facts WHERE kind<>'summary' AND marker=0 ORDER BY depth LIMIT 1
  ),
  pair AS (
    SELECT m.message_id,m.depth FROM facts m CROSS JOIN head h
      WHERE h.role='user' AND m.depth>h.depth AND m.kind<>'summary' AND m.marker=0 AND m.role='assistant'
      ORDER BY m.depth LIMIT 1
  ),
  result AS (
    SELECT json_object(
      'firstFound',EXISTS(SELECT 1 FROM first),
      'threadFound',EXISTS(SELECT 1 FROM first f JOIN session_threads t ON t.session_id=f.session_id AND t.thread_id=f.thread_id),
      'projectionUnavailable',EXISTS(SELECT 1 FROM facts WHERE COALESCE(projection_ready,0)=0),
      'invalidPath',EXISTS(SELECT 1 FROM facts WHERE broken_parent=1 OR typeof(seq)<>'integer' OR seq<0 OR seq>9007199254740991
        OR typeof(created_at) NOT IN ('integer','real') OR typeof(updated_at) NOT IN ('integer','real')
        OR kind NOT IN ('message','summary') OR status NOT IN ('settled','generating')
        OR thread_id='' OR message_id='' OR parent_message_id='' OR active_child_id='' OR branch_id='')
        OR COALESCE((SELECT active_child_id IS NOT NULL FROM ordered ORDER BY depth DESC LIMIT 1),0),
      'threadId',(SELECT thread_id FROM first),
      'headMessageId',(SELECT message_id FROM head),
      'headRole',(SELECT role FROM head),
      'pairedReplyMessageId',(SELECT message_id FROM pair),
      'followupCount',(SELECT COUNT(*) FROM ordered WHERE depth>(SELECT depth FROM head))-(SELECT COUNT(*) FROM pair),
      'revealedMessageIds',json((SELECT json_group_array(message_id) FROM (
        SELECT o.message_id FROM ordered o WHERE EXISTS(SELECT 1 FROM json_each(?) candidate WHERE candidate.value=o.message_id) ORDER BY o.depth
      )))
    ) AS value
  ) SELECT value FROM result`

interface PreviewAggregate {
  firstFound: number
  threadFound: number
  projectionUnavailable: number
  invalidPath: number
  threadId: string | null
  headMessageId: SessionBranchPreview['headMessageId']
  headRole: SessionBranchPreview['headRole']
  pairedReplyMessageId: SessionBranchPreview['pairedReplyMessageId']
  followupCount: number
  revealedMessageIds: string[]
}

/** The enclosing store fences the aggregate and any bridge slices to one commit. */
export async function readSqlBranchPreview(
  database: SessionRowSqlDatabase,
  request: SessionBranchPreviewRequest,
  commit: SessionRowCommit,
  bounded = true
): Promise<SessionBranchPreview> {
  validateBranchPreviewRequest(request)
  assertBranchPreviewRevision(request, commit)
  const params: SessionRowSqlBindValue[] = [
    request.sessionId,
    request.firstMessageId,
    JSON.stringify(request.revealedMessageIds ?? []),
  ]
  let value: string
  if (bounded) {
    const [first] = await database.query<{ value_length: number; value: string }>(
      `SELECT length(value) AS value_length,substr(value,1,4096) AS value FROM (${BRANCH_PREVIEW_SQL})`,
      params
    )
    if (
      !first ||
      typeof first.value !== 'string' ||
      !Number.isSafeInteger(first.value_length) ||
      first.value_length < 0
    )
      throw new Error('Invalid branch preview aggregate')
    value = first.value
    for (let offset = 4097; offset <= first.value_length; offset += 4096) {
      const [slice] = await database.query<{ value: string }>(
        `SELECT substr(value,?,4096) AS value FROM (${BRANCH_PREVIEW_SQL})`,
        [offset, ...params]
      )
      if (!slice || typeof slice.value !== 'string') throw new Error('Branch preview aggregate changed during read')
      value += slice.value
    }
    if ([...value].length !== first.value_length) throw new Error('Branch preview aggregate length is inconsistent')
  } else {
    const [result] = await database.query<{ value: string }>(BRANCH_PREVIEW_SQL, params)
    if (!result || typeof result.value !== 'string') throw new Error('Invalid branch preview aggregate')
    value = result.value
  }
  const result = JSON.parse(value) as PreviewAggregate
  if (!result.firstFound) throw new Error('Branch preview first message was not found')
  if (!result.threadFound) throw new Error('Branch preview thread was not found')
  if (result.invalidPath) throw new Error('Invalid branch preview path')
  if (result.projectionUnavailable) throw new Error('Branch preview path is unavailable')
  if (
    !result.threadId ||
    !Number.isSafeInteger(result.followupCount) ||
    result.followupCount < 0 ||
    (result.headRole !== null && !['system', 'user', 'assistant', 'tool'].includes(result.headRole))
  )
    throw new Error('Invalid branch preview aggregate')
  return {
    sessionId: request.sessionId,
    revision: commit.revision,
    threadId: result.threadId,
    headMessageId: result.headMessageId,
    headRole: result.headRole,
    pairedReplyMessageId: result.pairedReplyMessageId,
    followupCount: result.followupCount,
    ...(request.revealedMessageIds ? { revealedMessageIds: result.revealedMessageIds } : {}),
  }
}
