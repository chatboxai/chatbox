import { atom } from 'jotai'
import { atomFamily, atomWithStorage } from 'jotai/utils'
import type React from 'react'
import type { RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import platform from '@/platform'
import type { KnowledgeBase, MessagePicture, Toast } from '../../../shared/types'
import type { PreConstructedMessageState } from '../../types/input-box'

// Input box related state
const defaultPreConstructedMessageState = (): PreConstructedMessageState => ({
  draftMessageId: undefined,
  text: '',
  pictureKeys: [],
  attachments: [],
  links: [],
  preprocessedFiles: [],
  preprocessedLinks: [],
  preprocessingStatus: {
    files: {},
    links: {},
  },
  preprocessingPromises: {
    files: new Map<string, Promise<unknown>>(),
    links: new Map<string, Promise<unknown>>(),
  },
})

export const inputBoxLinksFamily = atomFamily((_sessionId: string) => atom<{ url: string }[]>([]))
export const inputBoxPreConstructedMessageFamily = atomFamily((_sessionId: string) =>
  atom(defaultPreConstructedMessageState())
)

// Atom to store collapsed state of providers
export const collapsedProvidersAtom = atomWithStorage<Record<string, boolean>>('collapsedProviders', {})

// key: group.id 或 '__unassigned__'；value 为 false 表示折叠；未设置/true 表示展开
export const expandedGroupsAtom = atomWithStorage<Record<string, boolean>>('expandedGroups', {})

// The group currently "entered" in the file-explorer sidebar (null = root / ungrouped view).
// The main panel shows this group's direct sessions; the rail flyout navigates between groups. Persisted.
export const currentSidebarGroupIdAtom = atomWithStorage<string | null>('currentSidebarGroupId', null)
