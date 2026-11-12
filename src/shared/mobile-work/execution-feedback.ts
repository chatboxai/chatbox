export const WORK_FOREGROUND_REQUIRED = 'WORK_FOREGROUND_REQUIRED'

export function workExecutionFeedback(value: unknown, t: (key: string) => unknown): string | undefined {
  const error =
    typeof value === 'string' ? value : value && typeof value === 'object' && 'error' in value ? value.error : undefined
  if (typeof error !== 'string' || !error.includes(WORK_FOREGROUND_REQUIRED)) return undefined
  return String(t('The task stopped when Chatbox left the foreground. Keep Chatbox open and retry the message.'))
}
