import { getSessionActionGate, type SessionLockState } from '@chatbox/core/session/action-gates'
import { isActionAvailableInMode, type SessionMode } from '@chatbox/core/session/mode-policy'
import { ActionIcon, Box, Button, Flex, Stack, Text, Tooltip } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { supportsSessionGeneration } from '@shared/session/capabilities'
import type { Session, SessionType } from '@shared/types'
import { IconAlignRight, IconChevronLeft, IconChevronRight, IconFold, IconTrash } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { deleteFork, switchFork, switchForkTo } from '@/stores/session/forks'
import { getSessionLockNotice, notifySessionLockBlocked } from '@/utils/session-lock-copy'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import Message from './Message'

type ForkGroupProps = {
  sessionId: string
  sessionType: SessionType
  msgId: string
  forks: NonNullable<Session['messageForksHash']>[string]
  sessionLocks: SessionLockState
  /** Resolved by the list container; work mode hides branch deletion (mode-policy). */
  sessionMode?: SessionMode
  assistantAvatarKey?: string
  sessionPicUrl?: string
}

export default function ForkGroup(props: ForkGroupProps) {
  const {
    sessionId,
    sessionType,
    msgId,
    forks,
    sessionLocks,
    sessionMode = 'chat',
    assistantAvatarKey,
    sessionPicUrl,
  } = props
  const [flash, setFlash] = useState(false)
  const prevLength = useRef(forks.lists.length)
  const previousPosition = useRef(forks.position)
  const previousListIds = useRef(new Set(forks.lists.map((list) => list.id)))
  const [expanded, setExpanded] = useState(false)
  const [revealedBranchIds, setRevealedBranchIds] = useState<Set<string>>(
    () =>
      new Set(
        forks.lists
          .filter(
            (list, index) => index !== forks.position && list.messages.some((message) => message.generating === true)
          )
          .map((list) => list.id)
      )
  )
  // Follow-up candidates that stream inside a saved branch stay rendered after
  // they finish (mirrors the sticky branch reveal above); collapsing or
  // switching branches drops them back into the count-only summary.
  const [revealedFollowupIds, setRevealedFollowupIds] = useState<Set<string>>(
    () =>
      new Set(
        forks.lists.flatMap((list, index) =>
          index === forks.position
            ? []
            : list.messages.filter((message) => message.generating === true).map((message) => message.id)
        )
      )
  )
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  // Switching and deleting no longer share one gate: chat mode may switch
  // branches while replies stream (the mode-aware switch-fork gate), while
  // deleting a branch stays locked during generation in every mode.
  const switchGate = getSessionActionGate('switch-fork', sessionLocks, { sessionMode })
  const forkControlsLocked = !switchGate.allowed
  const lockReason = switchGate.allowed ? '' : getSessionLockNotice(switchGate.reason, t)
  const deleteGate = getSessionActionGate('delete-fork', sessionLocks, { sessionMode })
  const deleteLocked = !deleteGate.allowed

  useEffect(() => {
    if (forks.lists.length > prevLength.current) {
      prevLength.current = forks.lists.length
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 2000)
      return () => clearTimeout(timer)
    }
    prevLength.current = forks.lists.length
  }, [forks.lists.length])

  useEffect(() => {
    // Branches with a live stream stay revealed no matter how they got here:
    // switching away from a streaming reply saves its tail into an *existing*
    // list slot (same id), which the new-id detection below cannot see, and a
    // hidden stream would leave the user no visible stop control on the card.
    // The streaming message ids are tracked too, so candidates that live in a
    // branch's follow-up tail get rendered (and keep their per-reply stop).
    const inactiveLists = forks.lists.filter((_, index) => index !== forks.position)
    const generatingBranchIds = inactiveLists
      .filter((list) => list.messages.some((message) => message.generating === true))
      .map((list) => list.id)
    const generatingMessageIds = inactiveLists.flatMap((list) =>
      list.messages.filter((message) => message.generating === true).map((message) => message.id)
    )

    if (forks.position !== previousPosition.current) {
      setExpanded(false)
      setRevealedBranchIds(new Set(generatingBranchIds))
      setRevealedFollowupIds(new Set(generatingMessageIds))
    } else {
      const addedInactiveBranchIds = forks.lists
        .filter((list, index) => index !== forks.position && !previousListIds.current.has(list.id))
        .map((list) => list.id)
      const toReveal = [...addedInactiveBranchIds, ...generatingBranchIds]
      if (toReveal.length > 0) {
        setRevealedBranchIds((current) => {
          if (toReveal.every((id) => current.has(id))) return current
          return new Set([...current, ...toReveal])
        })
      }
      if (generatingMessageIds.length > 0) {
        setRevealedFollowupIds((current) => {
          if (generatingMessageIds.every((id) => current.has(id))) return current
          return new Set([...current, ...generatingMessageIds])
        })
      }
    }

    previousPosition.current = forks.position
    previousListIds.current = new Set(forks.lists.map((list) => list.id))
  }, [forks.lists, forks.position])

  // lists append newest branches at the end; show newest-first so a Reply Again
  // Below that is still streaming appears directly under the prompt instead of
  // below every finished alternative.
  const alternativeBranches = forks.lists.flatMap((list, index) => {
    if (index === forks.position) {
      return []
    }

    // The preview starts at the branch's first real message, whatever its
    // role: Reply Again branches lead with an assistant candidate, while Save
    // & Resend branches lead with the original (pre-edit) prompt — exactly
    // what tells those branches apart. A prompt-headed branch also previews
    // the first reply below it, so the card reads as a question/answer pair.
    const headIndex = list.messages.findIndex((message) => !message.isSummary && !message.isForkMarker)
    const head = list.messages[headIndex]
    if (!head) {
      return []
    }
    const pairedReply =
      head.role === 'user'
        ? list.messages.find(
            (message, messageIndex) =>
              messageIndex > headIndex && message.role === 'assistant' && !message.isSummary && !message.isForkMarker
          )
        : undefined
    const previewedIds = new Set(pairedReply ? [head.id, pairedReply.id] : [head.id])

    // A branch saved mid-stream can hold live candidates beyond the previewed
    // messages (flat Reply Below, then switching an earlier fork). Render
    // those follow-ups too — hiding them would make the revealed card look
    // finished while it still streams and strip their per-reply stop controls.
    const shownFollowups = list.messages.filter(
      (message, messageIndex) =>
        messageIndex > headIndex &&
        !previewedIds.has(message.id) &&
        (message.generating === true || revealedFollowupIds.has(message.id))
    )

    return [
      {
        list,
        index,
        head,
        pairedReply,
        shownFollowups,
        followupCount: Math.max(
          0,
          list.messages.length - headIndex - 1 - (pairedReply ? 1 : 0) - shownFollowups.length
        ),
      },
    ]
  })
  const visibleBranches = [
    ...alternativeBranches.filter(({ list }) => expanded || revealedBranchIds.has(list.id)),
  ].reverse()

  const notifyControlsLocked = useCallback(() => {
    if (!switchGate.allowed) {
      void notifySessionLockBlocked(switchGate.reason, t)
    }
  }, [switchGate, t])

  const handleSwitch = useCallback(
    (direction: 'next' | 'prev') => {
      if (forkControlsLocked) {
        notifyControlsLocked()
        return
      }
      void switchFork(sessionId, msgId, direction)
    },
    [forkControlsLocked, msgId, notifyControlsLocked, sessionId]
  )

  // Deleting follows its own gate (locked during generation in every mode);
  // the store-side deleteFork guard is the per-action backstop.
  const handleDelete = useCallback(() => {
    if (!deleteGate.allowed) {
      void notifySessionLockBlocked(deleteGate.reason, t)
      return
    }
    void deleteFork(sessionId, msgId)
  }, [deleteGate, msgId, sessionId, t])

  const handleSwitchTo = useCallback(
    (position: number) => {
      if (forkControlsLocked) {
        notifyControlsLocked()
        return
      }
      void switchForkTo(sessionId, msgId, position)
    },
    [forkControlsLocked, msgId, notifyControlsLocked, sessionId]
  )

  const navigation = (
    <Flex gap="xs" align="center">
      <ActionIcon
        data-testid={TestId.message.forkPrevious}
        variant="subtle"
        size={20}
        radius="lg"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        aria-label={forkControlsLocked ? lockReason : t('Previous reply')}
        aria-disabled={forkControlsLocked}
        data-disabled={forkControlsLocked || undefined}
        onClick={() => handleSwitch('prev')}
      >
        <IconChevronLeft />
      </ActionIcon>
      <ActionMenu
        position="bottom"
        items={[
          ...(!expanded
            ? [
                {
                  text: t('Expand view'),
                  icon: IconAlignRight,
                  onClick: () => setExpanded(true),
                },
              ]
            : []),
          ...(expanded || revealedBranchIds.size > 0
            ? [
                {
                  text: t('Collapse other branches'),
                  icon: IconFold,
                  onClick: () => {
                    setExpanded(false)
                    setRevealedBranchIds(new Set())
                    setRevealedFollowupIds(new Set())
                  },
                },
              ]
            : []),
          ...(supportsSessionGeneration(sessionType) && isActionAvailableInMode('delete-fork', sessionMode)
            ? ([
                {
                  divider: true,
                },
                {
                  doubleCheck: !deleteLocked,
                  text: t('delete'),
                  icon: IconTrash,
                  disabled: deleteLocked && !isSmallScreen,
                  testId: TestId.message.forkDelete,
                  confirmTestId: TestId.message.forkDeleteConfirm,
                  onClick: handleDelete,
                },
              ] satisfies ActionMenuItemProps[])
            : []),
        ]}
      >
        <Text
          data-testid={TestId.message.forkCounter}
          c={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
          size="xs"
          className="cursor-pointer"
        >
          {forks.position + 1} / {forks.lists.length}
        </Text>
      </ActionMenu>
      <ActionIcon
        data-testid={TestId.message.forkNext}
        variant="subtle"
        size={20}
        radius="lg"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        aria-label={forkControlsLocked ? lockReason : t('Next reply')}
        aria-disabled={forkControlsLocked}
        data-disabled={forkControlsLocked || undefined}
        onClick={() => handleSwitch('next')}
      >
        <IconChevronRight />
      </ActionIcon>
    </Flex>
  )

  return (
    <Stack data-testid={TestId.message.forkGroup} data-message-id={msgId} gap="xs">
      <Flex justify="flex-end" pr="md" mr="md" className="self-end">
        {forkControlsLocked && !isSmallScreen ? (
          <Tooltip label={lockReason} withArrow>
            <Box className="inline-flex">{navigation}</Box>
          </Tooltip>
        ) : (
          navigation
        )}
      </Flex>
      {visibleBranches.map(({ list, index, head, pairedReply, shownFollowups, followupCount }) => {
        const switchButton = (
          <Button
            variant="subtle"
            color="chatbox-brand"
            size="compact-xs"
            disabled={forkControlsLocked && !isSmallScreen}
            aria-disabled={forkControlsLocked}
            onClick={() => handleSwitchTo(index)}
          >
            {t('Switch to this branch')}
          </Button>
        )

        return (
          <Stack
            key={list.id}
            gap={0}
            mx="md"
            p="xs"
            className="rounded-lg border border-solid border-chatbox-border-primary bg-chatbox-background-primary shadow-sm"
          >
            <Flex justify="space-between" align="center" gap="xs" wrap="wrap" px="xs" pb="xxs">
              <Text size="xs" c="chatbox-tertiary">
                {head.role === 'user'
                  ? t('Branch {{index}}', { index: index + 1 })
                  : t('Reply {{index}}', { index: index + 1 })}
              </Text>
              <Flex gap="xs" align="center" justify="flex-end" wrap="wrap">
                {followupCount > 0 && (
                  <Text size="xs" c="chatbox-tertiary">
                    {followupCount === 1
                      ? t('1 follow-up message')
                      : t('{{count}} follow-up messages', { count: followupCount })}
                  </Text>
                )}
                {forkControlsLocked && !isSmallScreen ? (
                  <Tooltip label={lockReason} withArrow>
                    <span>{switchButton}</span>
                  </Tooltip>
                ) : (
                  switchButton
                )}
              </Flex>
            </Flex>
            <Message
              id={head.id}
              msg={head}
              sessionId={sessionId}
              sessionType={sessionType}
              buttonGroup="none"
              readOnly
              allowGeneratingStop
              sessionLocks={sessionLocks}
              sessionMode={sessionMode}
              assistantAvatarKey={assistantAvatarKey}
              sessionPicUrl={sessionPicUrl}
            />
            {pairedReply && (
              <Message
                id={pairedReply.id}
                msg={pairedReply}
                sessionId={sessionId}
                sessionType={sessionType}
                buttonGroup="none"
                readOnly
                allowGeneratingStop
                sessionLocks={sessionLocks}
                sessionMode={sessionMode}
                assistantAvatarKey={assistantAvatarKey}
                sessionPicUrl={sessionPicUrl}
              />
            )}
            {shownFollowups.map((followup) => (
              <Message
                key={followup.id}
                id={followup.id}
                msg={followup}
                sessionId={sessionId}
                sessionType={sessionType}
                buttonGroup="none"
                readOnly
                allowGeneratingStop
                sessionLocks={sessionLocks}
                sessionMode={sessionMode}
                assistantAvatarKey={assistantAvatarKey}
                sessionPicUrl={sessionPicUrl}
              />
            ))}
          </Stack>
        )
      })}
      {visibleBranches.length > 0 && visibleBranches.length < alternativeBranches.length && (
        <Flex justify="flex-end" pr="md" mr="md">
          <Text size="xs" c="chatbox-tertiary">
            {t('Showing {{shown}} of {{total}} other replies', {
              shown: visibleBranches.length,
              total: alternativeBranches.length,
            })}
          </Text>
        </Flex>
      )}
    </Stack>
  )
}
