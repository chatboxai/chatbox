// The input box surface, shared with PendingActionBar so a pause can take over
// the same slot without the frame or the height shifting.
export const INPUT_SURFACE_CLASS_NAME =
  'relative flex flex-col justify-between gap-xs rounded-lg bg-chatbox-background-secondary px-3 py-2 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)]'

/** Desktop only: keeps the swap between input and pause from jumping. */
export const INPUT_SURFACE_MIN_HEIGHT_CLASS_NAME = 'min-h-[92px]'

export const INPUT_SURFACE_STYLE = { border: '0.5px solid var(--chatbox-border-primary)' }
