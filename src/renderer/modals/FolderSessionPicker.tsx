import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Checkbox, Flex, Input, ScrollArea, Text, UnstyledButton } from '@mantine/core'
import type { SessionFolder, SessionMetaRecord } from '@shared/types'
import { IconSearch, IconX } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { rendererApplication } from '@/app/renderer-application'
import { moveSessionsToFolder } from '@/stores/sessionFolders'

/** Current members of a folder, read from the session list cache. */
function folderMemberIds(folderId: string): Set<string> {
  return new Set(
    rendererApplication
      .sessionQueryBridge.getCachedSessionsMeta()
      .filter((s) => s.folderId === folderId)
      .map((s) => s.id)
  )
}

/**
 * Multi-select picker that bulk-assigns sessions to a folder. Sessions already
 * in the folder are pre-checked; the folder icon marks other-folder members.
 * Saving only writes the sessions whose membership actually changed.
 */
const FolderSessionPicker = NiceModal.create((props: { folder: SessionFolder }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const folder = props.folder
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  // Checked = will be in this folder after saving. Pre-check current members.
  // NiceModal keeps this component mounted across show() calls, so state must
  // be re-derived whenever the picker opens for a different folder — a plain
  // useState initializer would leak the previous folder's checks into the
  // save diff (same pattern as SessionSettingsModal's props sync).
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => folderMemberIds(folder.id))
  const originalIds = useMemo(() => folderMemberIds(folder.id), [folder.id])
  useEffect(() => {
    setCheckedIds(folderMemberIds(folder.id))
    setQuery('')
  }, [folder.id])

  const sessions = useMemo(() => {
    const all = rendererApplication.sessionQueryBridge.getCachedSessionsMeta()
    const keyword = query.trim().toLowerCase()
    return keyword ? all.filter((s) => s.name.toLowerCase().includes(keyword)) : all
  }, [query])

  const close = () => {
    modal.resolve(undefined)
    modal.hide()
  }

  const toggle = (sessionId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }

  const toggleVisibleAll = () => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      const allVisibleChecked = sessions.every((s) => next.has(s.id))
      for (const s of sessions) {
        if (allVisibleChecked) {
          next.delete(s.id)
        } else {
          next.add(s.id)
        }
      }
      return next
    })
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      // Diff against membership at open time: only touched sessions are written.
      const entries: { sessionId: string; folderId: string | null }[] = []
      for (const session of rendererApplication.sessionQueryBridge.getCachedSessionsMeta()) {
        const wasMember = originalIds.has(session.id)
        const willBeMember = checkedIds.has(session.id)
        if (wasMember !== willBeMember) {
          entries.push({ sessionId: session.id, folderId: willBeMember ? folder.id : null })
        }
      }
      await moveSessionsToFolder(entries)
      modal.resolve(undefined)
      modal.hide()
    } finally {
      setSaving(false)
    }
  }

  const renderSessionRow = (session: SessionMetaRecord) => {
    const checked = checkedIds.has(session.id)
    const inOtherFolder = session.folderId !== undefined && session.folderId !== folder.id
    return (
      <UnstyledButton
        key={session.id}
        onClick={() => toggle(session.id)}
        className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-chatbox-background-gray-secondary"
        aria-pressed={checked}
      >
        <Checkbox
          checked={checked}
          onChange={() => toggle(session.id)}
          onClick={(event) => event.stopPropagation()}
          aria-label={session.name}
          tabIndex={-1}
        />
        <Text span size="sm" lineClamp={1} flex={1} c={inOtherFolder ? 'chatbox-tertiary' : 'chatbox-primary'}>
          {session.name}
        </Text>
        {inOtherFolder && (
          <Text span size="xs" c="chatbox-tertiary" className="shrink-0">
            {t('In another folder')}
          </Text>
        )}
      </UnstyledButton>
    )
  }

  const allVisibleChecked = sessions.length > 0 && sessions.every((s) => checkedIds.has(s.id))
  const someVisibleChecked = sessions.some((s) => checkedIds.has(s.id))

  return (
    <AdaptiveModal opened={modal.visible} onClose={close} centered size="md" title={`${t('Add Chats to Folder')} — ${folder.name}`}>
      <Input
        data-autofocus
        leftSection={<ScalableIcon icon={IconSearch} size={16} />}
        rightSection={
          query ? (
            <ScalableIcon
              icon={IconX}
              size={14}
              className="cursor-pointer text-chatbox-tertiary"
              onClick={() => setQuery('')}
            />
          ) : undefined
        }
        placeholder={t('Search')}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        mb="xs"
      />
      <Flex align="center" justify="space-between" px={4} pb={4}>
        <Checkbox
          checked={allVisibleChecked}
          indeterminate={!allVisibleChecked && someVisibleChecked}
          onChange={toggleVisibleAll}
          label={t('Select all')}
          size="xs"
        />
        <Text size="xs" c="chatbox-tertiary">
          {t('{{count}} selected', { count: checkedIds.size })}
        </Text>
      </Flex>
      <ScrollArea.Autosize mah="50vh" type="auto">
        <Flex direction="column" gap={0}>
          {sessions.map(renderSessionRow)}
          {sessions.length === 0 && (
            <Text size="sm" c="chatbox-tertiary" px={8} py={8} ta="center">
              {t('No conversations found.')}
            </Text>
          )}
        </Flex>
      </ScrollArea.Autosize>
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={close} />
        <Button onClick={save} loading={saving} disabled={checkedIds.size === 0 && originalIds.size === 0}>
          {t('Save')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default FolderSessionPicker
