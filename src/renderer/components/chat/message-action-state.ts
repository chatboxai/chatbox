export type MessageButtonGroup = 'auto' | 'always' | 'none'

export function getMessageActionVisibilityClass(isVisible: boolean): string {
  if (isVisible) {
    return 'visible opacity-100 pointer-events-auto'
  }
  return [
    'invisible opacity-0 pointer-events-none',
    'group-hover/message:visible group-hover/message:opacity-100 group-hover/message:pointer-events-auto',
    // Touch screens cannot hover, so every message keeps its actions on screen.
    '[@media(hover:none)]:visible [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto',
  ].join(' ')
}
