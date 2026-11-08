import { MESSAGE_SWIPE_CUE } from '@chatbox/core/session/message-swipe'
import { TestId } from '@shared/automation/testids'
import { IconReload } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/**
 * Feedback for swiping a reply to the right, drawn inside the row that `useMessageSwipe` moves. The row's
 * `data-swipe-state` decides what shows and `--message-swipe-turn` turns the retry icon, so the gesture never
 * re-renders the message.
 */

/** Classes for the avatar while the swipe shows the retry ring in its place. */
export const MESSAGE_SWIPE_AVATAR_HIDDEN_CLASS =
  'group-data-[swipe-state=armed]/swipe-row:invisible group-data-[swipe-state=dragging]/swipe-row:invisible'

/** Classes for the name row while the swipe hint takes its line. */
export const MESSAGE_SWIPE_NAME_HIDDEN_CLASS = cn(
  MESSAGE_SWIPE_AVATAR_HIDDEN_CLASS,
  'group-data-[swipe-state=unavailable]/swipe-row:invisible'
)

const turnStyle = { transform: 'rotate(var(--message-swipe-turn, 0deg))' }

const SWIPE_SHOWN_CLASS =
  'group-data-[swipe-state=dragging]/swipe-row:visible group-data-[swipe-state=armed]/swipe-row:visible group-data-[swipe-state=unavailable]/swipe-row:visible'

/** Horizontal padding of a reply bubble on small screens; a pinned cue moves inside the bubble by this much. */
const BUBBLE_INSET = 14
const PINNED_BUBBLE_INSET = `calc(var(--message-swipe-pin-progress, 0) * ${BUBBLE_INSET}px)`

/** Outlined retry ring that takes the avatar's place, same size, while the reply is dragged or armed. */
function MessageSwipeAvatarRetry({ size }: { size: number }) {
  return (
    <span
      className={cn(
        'pointer-events-none invisible relative box-border flex shrink-0 items-center justify-center rounded-full',
        'border-[1.5px] border-solid border-chatbox-border-primary text-chatbox-tint-tertiary',
        'transition-colors duration-150',
        'group-data-[swipe-state=dragging]/swipe-row:visible group-data-[swipe-state=armed]/swipe-row:visible',
        'group-data-[swipe-state=armed]/swipe-row:border-chatbox-tint-brand group-data-[swipe-state=armed]/swipe-row:text-chatbox-tint-brand'
      )}
      style={{ width: size, height: size }}
    >
      <IconReload size={Math.round(size * 0.58)} stroke={2.25} style={turnStyle} />
    </span>
  )
}

/**
 * The line that replaces the name row while swiping: what releasing will do, or why it will not. Without an avatar the
 * retry icon leads the line instead.
 */
function MessageSwipeHint({ top, leadingIcon, inset }: { top: number; leadingIcon: boolean; inset: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid={TestId.message.swipeHint}
      className={cn(
        'pointer-events-none invisible relative flex h-5 min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap text-sm leading-5',
        'font-medium text-chatbox-tint-tertiary transition-colors duration-150',
        SWIPE_SHOWN_CLASS,
        'group-data-[swipe-state=armed]/swipe-row:text-chatbox-tint-brand group-data-[swipe-state=unavailable]/swipe-row:font-normal'
      )}
      style={{
        marginTop: top,
        paddingLeft: inset ? PINNED_BUBBLE_INSET : undefined,
      }}
    >
      {leadingIcon && (
        <IconReload
          size={16}
          stroke={2.25}
          className="shrink-0 group-data-[swipe-state=unavailable]/swipe-row:hidden"
          style={turnStyle}
        />
      )}
      <span className="hidden min-w-0 truncate group-data-[swipe-state=dragging]/swipe-row:block">
        {t('Keep swiping to reply again')}
      </span>
      <span className="hidden min-w-0 truncate group-data-[swipe-state=armed]/swipe-row:block">
        {t('Release to reply again')}
      </span>
      <span className="hidden min-w-0 truncate group-data-[swipe-state=unavailable]/swipe-row:block">
        {t('Generating, try again when done')}
      </span>
    </div>
  )
}

/**
 * The swipe cue: the retry ring over the avatar and the hint over the name row, drawn over the top of the row. When the
 * row's top is scrolled out of view, `useMessageSwipe` moves the cue down to the top of the row's visible part
 * (`--message-swipe-pin`) and shows a band of the surface colour behind it that fades out below, so the text it
 * passes over stays out of the way: the page in the classic layout, the bubble in the bubble layout. A pinned cue over
 * a bubble moves inside the bubble's padding: only the hint when the avatar sits beside the reply, the whole cue when
 * the bubble starts at the cue's left edge (avatar above the reply, or no avatar).
 */
export function MessageSwipeCue({
  avatarSize,
  avatarGap,
  nameRowOffset,
  farSideSpace,
  showAvatar,
  avatarAbove,
  bubble,
}: {
  avatarSize: number
  avatarGap: number
  nameRowOffset: number
  farSideSpace: number
  showAvatar: boolean
  /** The avatar sits above the reply, so the cue's left edge is the reply's left edge. */
  avatarAbove: boolean
  bubble: boolean
}) {
  const avatarBeside = showAvatar && !avatarAbove
  const surface = bubble ? 'var(--chatbox-background-secondary)' : 'var(--chatbox-background-primary)'
  return (
    <div
      aria-hidden
      data-testid={TestId.message.swipeCue}
      className={cn('pointer-events-none invisible absolute left-0 top-0 z-10 flex', SWIPE_SHOWN_CLASS)}
      style={{
        right: farSideSpace,
        gap: avatarGap,
        paddingLeft: bubble && !avatarBeside ? PINNED_BUBBLE_INSET : undefined,
        transform: 'translateY(var(--message-swipe-pin, 0px))',
      }}
    >
      <span
        className="absolute"
        style={{
          left: 'var(--message-swipe-band-left, 0px)',
          width: 'var(--message-swipe-band-width, 0px)',
          top: -MESSAGE_SWIPE_CUE.gap,
          bottom: 0,
          opacity: 'var(--message-swipe-pin-progress, 0)',
          background: surface,
        }}
      >
        <span
          className="absolute inset-x-0 top-full"
          style={{ height: MESSAGE_SWIPE_CUE.fade, background: `linear-gradient(${surface}, transparent)` }}
        />
      </span>
      {showAvatar && <MessageSwipeAvatarRetry size={avatarSize} />}
      <MessageSwipeHint top={nameRowOffset} leadingIcon={!showAvatar} inset={bubble && avatarBeside} />
    </div>
  )
}
