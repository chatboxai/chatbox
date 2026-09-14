import { messageHasChatboxSearchSignInError } from '@shared/session/web-search-sign-in-error'
import { hasPendingPauseInteraction } from '../message-approval'
import type { SessionPresentationSummary } from '../session/session-tree/types'
import type { LogicalBackupRow } from './sharded-format'

/** Rebuilds the bounded-window hint from validated rows, never from archive-supplied caches. */
export class BackupPresentation {
  readonly value: SessionPresentationSummary = {
    messageCount: 0,
    userMessageCount: 0,
    fileMessageCount: 0,
    generatingMessageCount: 0,
    pausedMessageCount: 0,
    hasThreads: false,
    hasForks: false,
    webSearchSignInErrorCount: 0,
    latestMessageHasWebSearchSignInError: false,
  }
  private active = ''
  add(row: LogicalBackupRow) {
    if (row.kind === 'header') {
      this.active = row.activeThreadId
      this.value.hasForks = Object.keys(row.forkCreatedAt ?? {}).length > 0
    } else if (row.kind === 'thread') {
      if (row.order !== -1) this.value.hasThreads = true
    } else {
      if (row.branchId !== null) this.value.hasForks = true
      if (row.threadId !== this.active) return
      const message = row.value
      this.value.messageCount++
      this.value.userMessageCount += Number(message.role === 'user')
      this.value.fileMessageCount += Number(Boolean(message.files?.length))
      this.value.generatingMessageCount += Number(message.generating === true)
      this.value.pausedMessageCount += Number(hasPendingPauseInteraction([message]))
      const searchError = messageHasChatboxSearchSignInError(message)
      this.value.webSearchSignInErrorCount! += Number(searchError)
      if (message.role !== 'system' && !message.isSummary) this.value.latestMessageHasWebSearchSignInError = searchError
    }
  }
}
