import { SOUL_VIRTUAL_PATH } from '@shared/types/agent-persona'
import { readSoul, updateSoul, writeSoul } from '@/stores/agentPersonaStore'

/**
 * Virtual-file bridge for the Soul document. File tools route the explicit
 * `chatbox://SOUL.md` path here instead of the filesystem, so the model can read
 * and edit its own Soul when the user asks. Writes persist immediately but the
 * running session keeps its frozen persona snapshot.
 */

export function isSoulVirtualPath(filePath: string): boolean {
  return filePath.trim().toLowerCase() === SOUL_VIRTUAL_PATH.toLowerCase()
}

const SNAPSHOT_NOTE = 'The change takes effect in future agent sessions; this session keeps its frozen Soul snapshot.'

export async function readSoulVirtualFile(): Promise<{ file_path: string; content: string }> {
  const record = await readSoul()
  return { file_path: SOUL_VIRTUAL_PATH, content: record.content }
}

export async function writeSoulVirtualFile(
  content: string
): Promise<{ success: true; file_path: string; note: string }> {
  await writeSoul(content)
  return { success: true, file_path: SOUL_VIRTUAL_PATH, note: SNAPSHOT_NOTE }
}

export async function editSoulVirtualFile(
  edits: Array<{ old_text: string; new_text: string }>
): Promise<{ success: true; file_path: string; edits: number; note: string } | { error: string }> {
  // The read-modify-write runs atomically inside the soul mutation lock, so a
  // concurrent Settings save cannot be clobbered by a stale edit.
  const result = await updateSoul((content) => {
    let text = content
    for (const [index, edit] of edits.entries()) {
      const first = text.indexOf(edit.old_text)
      if (first === -1) {
        return { error: `Edit ${index + 1}: search text not found` }
      }
      if (text.indexOf(edit.old_text, first + edit.old_text.length) !== -1) {
        return { error: `Edit ${index + 1}: search text is not unique` }
      }
      text = text.slice(0, first) + edit.new_text + text.slice(first + edit.old_text.length)
    }
    return text
  })
  if ('error' in result) return result
  return { success: true, file_path: SOUL_VIRTUAL_PATH, edits: edits.length, note: SNAPSHOT_NOTE }
}
