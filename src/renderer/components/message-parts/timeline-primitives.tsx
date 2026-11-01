import { Box, Group } from '@mantine/core'
import { WORK_TIMELINE_ROW_GAP, WORK_TIMELINE_TEXT_GAP } from '@shared/work-timeline'
import clsx from 'clsx'
import type { FC } from 'react'

export const TIMELINE_ICON_SIZE = 14
export const TIMELINE_ICON_GAP = 10
export const TIMELINE_ROW_HEIGHT = 22
// Activity rows read a size below the narration and in its quietest tone, so the
// text between them is what the eye follows.
export const TIMELINE_LABEL_FONT_SIZE = 13
export const TIMELINE_ROW_GAP = WORK_TIMELINE_ROW_GAP
export const TIMELINE_TEXT_GAP = WORK_TIMELINE_TEXT_GAP
// A row's details hang under its text column, one indent past the icon.
export const TIMELINE_DETAIL_INDENT = TIMELINE_ICON_SIZE + TIMELINE_ICON_GAP
// Unfolded steps read as a list under their summary row: the list hangs behind a
// hairline so a fold reads as one group instead of rows beside the summary.
export const TIMELINE_GROUP_INDENT = 12
export const TIMELINE_GROUP_BORDER = '1px solid color-mix(in srgb, var(--chatbox-border-primary) 60%, transparent)'
// Amber marks the one state that needs a decision, on the row and on its details.
export const TIMELINE_APPROVAL_BORDER = '2px solid color-mix(in srgb, var(--chatbox-tint-warning) 70%, transparent)'
// A settled row keeps its disclosure arrow out of the way until the row is hovered or
// reached by keyboard — except where there is no hover to answer, so a touch device
// shows the arrow and the row still reads as something that opens.
export const TIMELINE_DISCLOSURE_CLASS =
  'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100 motion-safe:transition-opacity'

export const InlineToolIcon: FC<{
  icon: React.ElementType
  size: number
  color?: string
  className?: string
}> = ({ icon: Icon, size, color, className }) => (
  <Box
    component="span"
    className={clsx('inline-flex shrink-0 items-center justify-center leading-none', className)}
    style={{ width: size, height: size, color }}
  >
    <Icon size={size} color={color} style={{ display: 'block' }} />
  </Box>
)

export const ToolCallRunningDots: FC = () => (
  <Group gap={2} wrap="nowrap" ml={2} style={{ color: 'var(--chatbox-tint-brand)' }}>
    {[0, 1, 2].map((index) => (
      <Box
        key={index}
        component="span"
        className="animate-pulse"
        style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          backgroundColor: 'currentColor',
          animationDelay: `${index * 150}ms`,
        }}
      />
    ))}
  </Group>
)

// The leading column of a timeline row: the step's icon, carrying its state as the
// only color on the row. Steps unfolded inside a run leave the column empty — the
// group they hang in already says they belong to the row above.
export const TimelineStepIcon: FC<{ icon: React.ElementType; stateColor: string }> = ({ icon, stateColor }) => (
  <Box
    data-timeline-step-icon=""
    style={{
      width: TIMELINE_ICON_SIZE,
      height: TIMELINE_ICON_SIZE,
      flex: 'none',
      color: stateColor,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <InlineToolIcon icon={icon} size={TIMELINE_ICON_SIZE} />
  </Box>
)
