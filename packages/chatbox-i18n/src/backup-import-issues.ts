export function getBackupImportIssueMessage(
  issue: { code: string; message: string },
  t: (key: string) => string
): string {
  switch (issue.code) {
    case 'record-order':
      return t('A record outside its owning data section was skipped.')
    case 'selection-mismatch':
      return t('A record outside the selected data categories was skipped.')
    case 'missing-session':
      return t('A record whose conversation is missing or out of order was skipped.')
    case 'missing-thread':
      return t('A message whose thread is missing was skipped.')
    case 'duplicate-row':
    case 'duplicate-session':
    case 'duplicate-thread':
    case 'duplicate-message':
    case 'duplicate-global':
    case 'duplicate-resource':
      return t('A duplicate record was skipped.')
    case 'missing-resource':
      return t('An attachment referenced by the backup is missing.')
    case 'unindexed-resource':
      return t('An attachment without a resource record was skipped.')
    case 'message-identity':
      return t('A message with mismatched row and content IDs was skipped.')
    case 'invalid-row':
      return t('A record with invalid identity or ordering was skipped.')
    case 'unreachable-message':
      return t('An unreachable message branch was skipped.')
    case 'missing-active-thread':
      return t('The active thread was reset to an available thread.')
    case 'thread-order':
    case 'sibling-order':
      return t('Conflicting conversation ordering was repaired.')
    case 'thread-root':
      return t('A thread root was repaired.')
    case 'selected-child':
    case 'pending-branch':
    case 'fork-reference':
      return t('An invalid branch reference was cleared.')
    case 'compaction-reference':
      return t('An invalid summary reference was removed.')
    case 'session-projection':
      return t(
        'Conversation data was saved, but its list could not be updated. Use Recover Conversation List in settings.'
      )
    case 'invalid-legacy-session':
      return t('A conversation could not be converted. Local data was kept.')
    case 'unusable-session':
      return t('A conversation with unusable structure was skipped. Local data was kept.')
    default:
      return issue.message
  }
}
