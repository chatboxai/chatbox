export function getBackupFilename(exportedAt: Date): string {
  const year = exportedAt.getFullYear()
  const month = exportedAt.getMonth() + 1
  const day = exportedAt.getDate()
  return `chatbox-backup-${year}-${month}-${day}.zip`
}
