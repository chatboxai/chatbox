import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Avatar, Flex, Highlight, Stack, Text } from '@mantine/core'
import type { CopilotDetail } from '@shared/types'
import { IconDots, IconEdit, IconMessageCircle2Filled, IconStar, IconStarFilled, IconTrash } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionMenu from '@/components/ActionMenu'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { ImageInStorage } from '@/components/Image'
import { useMyCopilots } from '@/hooks/useCopilots'
import * as remote from '@/packages/remote'
import CopilotDetailModal from './CopilotDetailModal'

export interface CopilotItemProps {
  copilot: CopilotDetail
  type?: 'local' | 'remote'
  highlightTerm?: string
}

export function CopilotItem({ copilot, type = 'local', highlightTerm = '' }: CopilotItemProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const store = useMyCopilots()
  const [detailOpened, setDetailOpened] = useState(false)
  const { name, avatar, picUrl, description, prompt, tags, createdAt } = copilot

  const handleUse = (detail: CopilotDetail) => {
    void remote
      .recordCopilotUsage({ id: detail.id, action: 'use_copilot' })
      .catch((error) => console.warn('[recordCopilotUsage] failed', error))

    navigate({ to: '/', search: { copilot: JSON.stringify(detail) } })
  }

  // Format the publish date
  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <>
      <Stack
        onClick={() => setDetailOpened(true)}
        className="
        group
        relative
        p-xs
        gap-xs
        rounded-md
        border border-solid border-chatbox-border-primary
        bg-chatbox-background-primary
        cursor-pointer
      "
      >
        {/* Header: Avatar + Title */}
        <Flex align="center" gap="xs">
          {avatar?.type === 'storage-key' || avatar?.type === 'url' || picUrl ? (
            <Avatar
              src={avatar?.type === 'storage-key' ? '' : avatar?.url || picUrl}
              alt={name}
              size={36}
              radius="md"
              className="flex-shrink-0 border border-solid border-chatbox-border-primary"
            >
              {avatar?.type === 'storage-key' ? (
                <ImageInStorage storageKey={avatar.storageKey} className="object-cover object-center w-full h-full" />
              ) : (
                // Fallback: first character of name
                name
                  ?.charAt(0)
                  ?.toUpperCase()
              )}
            </Avatar>
          ) : (
            <Stack
              w={36}
              h={36}
              align="center"
              justify="center"
              className="flex-shrink-0 rounded-md bg-chatbox-background-brand-secondary"
            >
              <ScalableIcon icon={IconMessageCircle2Filled} size={20} className="text-chatbox-tint-brand" />
            </Stack>
          )}

          <Highlight
            highlight={highlightTerm}
            fw={600}
            size="sm"
            c="chatbox-secondary"
            lineClamp={2}
            className="flex-1 leading-snug"
          >
            {name}
          </Highlight>

          <Flex gap={0} align="center" onClick={(e) => e.stopPropagation()}>
            {type === 'local' && (
              <ActionMenu
                position="bottom-end"
                items={[
                  {
                    text: t('Edit'),
                    icon: IconEdit,
                    onClick: () => {
                      void NiceModal.show('copilot-settings', {
                        copilot,
                        mode: 'edit',
                        onSave: (updated: CopilotDetail) => {
                          store.addOrUpdate(updated)
                        },
                        onDelete: (id: string) => {
                          store.remove(id)
                        },
                      })
                    },
                  },
                  ...(copilot.starred
                    ? [
                        {
                          text: t('Unstar'),
                          icon: IconStarFilled,
                          onClick: () => {
                            store.addOrUpdate({
                              ...copilot,
                              starred: false,
                            })
                          },
                        },
                      ]
                    : [
                        {
                          text: t('Star'),
                          icon: IconStar,
                          onClick: () => {
                            store.addOrUpdate({
                              ...copilot,
                              starred: true,
                            })
                          },
                        },
                      ]),
                  {
                    divider: true,
                  },
                  {
                    doubleCheck: true,
                    text: t('Delete'),
                    icon: IconTrash,
                    onClick: () => {
                      store.remove(copilot.id)
                    },
                  },
                ]}
              >
                <ActionIcon
                  variant="transparent"
                  size={28}
                  color={type === 'local' && copilot.starred ? 'chatbox-brand' : 'chatbox-tertiary'}
                  className="hover:bg-chatbox-background-gray-secondary rounded-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  {type === 'local' && copilot.starred ? (
                    <ScalableIcon icon={IconStarFilled} size={16} />
                  ) : (
                    <ScalableIcon icon={IconDots} size={16} />
                  )}
                </ActionIcon>
              </ActionMenu>
            )}
          </Flex>
        </Flex>

        {/* Description */}
        <Highlight
          highlight={highlightTerm}
          size="xs"
          c="chatbox-secondary"
          lineClamp={2}
          className="flex-shrink-0 leading-snug"
        >
          {description || prompt}
        </Highlight>

        {/* Footer: Tags + Date */}
        <Flex align="center" justify="space-between" mt="auto">
          {/* Tags */}
          <Flex gap="xxs" wrap="wrap" className="flex-1 flex-nowrap">
            {tags?.map((tag) => (
              <Text
                key={tag}
                span
                size="xs"
                c="chatbox-brand"
                px={6}
                py={2}
                className=" block rounded-full bg-chatbox-background-brand-secondary"
              >
                {t(tag)}
              </Text>
            ))}
          </Flex>

          {/* Publish Date */}
          {formattedDate && (
            <Text size="xs" c="chatbox-tertiary" className="whitespace-nowrap ml-2">
              {type === 'local'
                ? t('Created on {{date}}', { date: formattedDate })
                : t('Published on {{date}}', { date: formattedDate })}
            </Text>
          )}
        </Flex>
      </Stack>

      <CopilotDetailModal
        opened={detailOpened}
        onClose={() => setDetailOpened(false)}
        type={type}
        copilot={copilot}
        onUse={handleUse}
      />
    </>
  )
}

export default CopilotItem
