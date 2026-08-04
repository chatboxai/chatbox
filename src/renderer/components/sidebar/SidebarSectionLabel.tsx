import { Flex, Text } from '@mantine/core'
import type { ReactNode } from 'react'

interface SidebarSectionLabelProps {
  /** Optional leading icon (e.g. IconSparkles for the Pinned Chats section). */
  icon?: ReactNode
  label: string
}

/**
 * Small section header label used above the pinned section (and reusable for
 * future sidebar sections). Mirrors the visual weight of the old `SectionLabel`
 * in SessionList: uppercase-ish, small, tertiary color, padded.
 */
export default function SidebarSectionLabel({ icon, label }: SidebarSectionLabelProps) {
  return (
    <Flex align="center" gap={6} px="md" pt="sm" pb={4}>
      {icon}
      <Text size="xs" fw={600} c="chatbox-tertiary">
        {label}
      </Text>
    </Flex>
  )
}
