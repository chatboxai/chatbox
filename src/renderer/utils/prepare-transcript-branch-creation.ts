import { uiStore } from '@/stores/uiStore'

/** Keep branch creation attached to the list that accepted the user's action. */
export async function prepareTranscriptBranchCreation(sessionId: string): Promise<boolean> {
  const navigation = uiStore.getState().transcriptNavigation
  if (navigation?.sessionId !== sessionId) return false
  if (!(await navigation.prepareBranchCreation())) return false
  return uiStore.getState().transcriptNavigation?.owner === navigation.owner
}
