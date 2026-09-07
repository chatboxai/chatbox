import NiceModal from '@ebay/nice-modal-react'
import i18n from '@/i18n'
import platform from '@/platform'

/**
 * Renderer-only confirmation for persisted sandbox artifacts.
 *
 * The application service never imports modal or translation code; callers keep
 * the existing explicit confirmation boundary before invoking deletion.
 */
export async function confirmSessionDeletion(sessionId: string): Promise<boolean> {
  if (!platform.isDesktopLike || !platform.sandboxHasArtifacts) return true
  try {
    const { has } = await platform.sandboxHasArtifacts({ sessionId })
    if (!has) return true
    const confirmed = await NiceModal.show('confirm', {
      title: i18n.t('Delete this chat?'),
      message: i18n.t(
        'This chat has downloadable files generated in the sandbox. Deleting it will permanently remove those files.'
      ),
      confirmText: i18n.t('Delete'),
      danger: true,
    })
    return confirmed === true
  } catch {
    return true
  }
}
