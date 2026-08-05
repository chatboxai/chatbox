import { ActionIcon, Flex } from '@mantine/core'
import { IconArrowUp, IconPlayerStopFilled } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '../common/ScalableIcon'

type InputBoxActionButtonsProps = {
  generating: boolean
  sendDisabled: boolean
  onSend: () => void
  onStop?: () => void
}

export default function InputBoxActionButtons({
  generating,
  sendDisabled,
  onSend,
  onStop,
}: InputBoxActionButtonsProps) {
  const { t } = useTranslation()

  return (
    <Flex gap={4} className="shrink-0 mb-1">
      {generating && (
        <ActionIcon
          aria-label={t('Stop generating')}
          size={32}
          variant="filled"
          color="dark"
          radius="xl"
          onClick={onStop}
        >
          <ScalableIcon icon={IconPlayerStopFilled} size={16} />
        </ActionIcon>
      )}
      <ActionIcon
        aria-label={t('Send')}
        disabled={sendDisabled}
        size={32}
        variant="filled"
        color="chatbox-brand"
        radius="xl"
        onClick={onSend}
        className={sendDisabled ? 'disabled:!opacity-100 !text-white' : undefined}
        style={sendDisabled ? { backgroundColor: 'rgba(222, 226, 230, 1)' } : undefined}
      >
        <ScalableIcon icon={IconArrowUp} size={16} />
      </ActionIcon>
    </Flex>
  )
}
