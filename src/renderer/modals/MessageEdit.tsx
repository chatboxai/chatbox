import NiceModal, { muiDialogV5, useModal } from '@ebay/nice-modal-react'
import PersonIcon from '@mui/icons-material/Person'
import SettingsIcon from '@mui/icons-material/Settings'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  type SelectChangeEvent,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Message, type MessageContentParts, type MessageRole, MessageRoleEnum } from '@/../shared/types'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import * as sessionActions from '@/stores/sessionActions'

const MessageEdit = NiceModal.create((props: { sessionId: string; msg: Message }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  // const [data, setData] = useAtom(atoms.messageEditDialogShowAtom)
  const [sessionId] = useState(props.sessionId)
  const [msg, _setMsg] = useState<Message>({ ...props.msg })
  const setMsg = useCallback((m: Partial<Message>) => {
    _setMsg((_m) => ({ ..._m, ...m }))
  }, [])

  // Create stable IDs for text parts to maintain focus
  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore contents change
  const textPartIds = useMemo(() => {
    const ids: string[] = []
    msg.contentParts.forEach((part, index) => {
      if (part.type === 'text') {
        ids[index] = `${msg.id}-text-${index}`
      }
    })
    return ids
  }, [msg.id])

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  const onSave = () => {
    if (!msg || !sessionId) {
      return
    }
    sessionActions.modifyMessage(sessionId, msg, true)
    onClose()
  }
  const onSaveAndReply = () => {
    if (!msg || !sessionId) {
      return
    }
    onSave()
    sessionActions.generateMoreInNewFork(sessionId, msg.id)
  }

  const onRoleSelect = (e: SelectChangeEvent) => {
    if (!msg || !sessionId) {
      return
    }
    setMsg({
      role: e.target.value as MessageRole,
    })
  }
  const onContentPartInput = (index: number, text: string) => {
    if (!msg || !sessionId) {
      return
    }
    const newContentParts: MessageContentParts = [...msg.contentParts]
    if (newContentParts[index] && newContentParts[index].type === 'text') {
      newContentParts[index] = { type: 'text', text }
    }
    setMsg({
      contentParts: newContentParts,
    })
  }
  const handleTextPartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    const target = event.target as HTMLTextAreaElement
    const cursorPosition = target.selectionStart
    const textLength = target.value.length

    // Find the indices of all text parts
    const textPartIndices: number[] = []
    msg.contentParts.forEach((part, idx) => {
      if (part.type === 'text') {
        textPartIndices.push(idx)
      }
    })

    const currentTextPartIndex = textPartIndices.indexOf(index)

    // Helper function to focus on another text part
    const focusTextPart = (targetIndex: number, cursorPos: 'start' | 'end') => {
      const element = document.getElementById(`${msg.id}-input-${targetIndex}`) as HTMLTextAreaElement
      if (element) {
        event.preventDefault()
        element.focus()
        setTimeout(() => {
          const position = cursorPos === 'start' ? 0 : element.value.length
          element.setSelectionRange(position, position)
        }, 0)
      }
    }

    const isAtStart = cursorPosition === 0
    const isAtEnd = cursorPosition === textLength
    const hasPrevious = currentTextPartIndex > 0
    const hasNext = currentTextPartIndex < textPartIndices.length - 1

    // Navigation logic
    const shouldNavigate =
      (event.key === 'ArrowUp' && isAtStart && hasPrevious) ||
      (event.key === 'ArrowLeft' && isAtStart && hasPrevious) ||
      (event.key === 'Backspace' && isAtStart && hasPrevious && target.selectionStart === target.selectionEnd)

    if (shouldNavigate) {
      focusTextPart(textPartIndices[currentTextPartIndex - 1], 'end')
    } else if (
      (event.key === 'ArrowDown' && isAtEnd && hasNext) ||
      (event.key === 'ArrowRight' && isAtEnd && hasNext)
    ) {
      focusTextPart(textPartIndices[currentTextPartIndex + 1], 'start')
    }

    // Handle the original keyboard shortcuts
    onKeyDown(event)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!msg || !sessionId) {
      return
    }
    const ctrlOrCmd = event.ctrlKey || event.metaKey
    const shift = event.shiftKey

    // ctrl + shift + enter 保存并生成
    if (event.key === 'Enter' && ctrlOrCmd && shift) {
      event.preventDefault()
      onSaveAndReply()
      return
    }
    // ctrl + enter 保存
    if (event.key === 'Enter' && ctrlOrCmd && !shift) {
      event.preventDefault()
      onSave()
      return
    }
  }

  if (!msg || !sessionId) {
    return null
  }

  return (
    <Dialog
      {...muiDialogV5(modal)}
      fullWidth
      maxWidth="md"
      onClose={() => {
        modal.resolve()
        modal.hide()
      }}
    >
      <DialogTitle></DialogTitle>
      <DialogContent>
        <Select value={msg.role} onChange={onRoleSelect} size="small" id={`${msg.id}-select`} className="mb-2">
          <MenuItem value={MessageRoleEnum.System}>
            <Avatar>
              <SettingsIcon />
            </Avatar>
          </MenuItem>
          <MenuItem value={MessageRoleEnum.User}>
            <Avatar>
              <PersonIcon />
            </Avatar>
          </MenuItem>
          <MenuItem value={MessageRoleEnum.Assistant}>
            <Avatar>
              <SmartToyIcon />
            </Avatar>
          </MenuItem>
        </Select>
        <Box
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            backgroundColor: 'background.paper',
            p: 1,
          }}
        >
          {msg.contentParts.map((part, index) => {
            if (part.type === 'text') {
              return (
                <TextField
                  key={textPartIds[index] || `text-part-${index}`}
                  className="w-full"
                  autoFocus={!isSmallScreen && index === 0}
                  multiline
                  minRows={1}
                  maxRows={15}
                  placeholder="prompt"
                  value={part.text}
                  onChange={(e) => onContentPartInput(index, e.target.value)}
                  id={`${msg.id}-input-${index}`}
                  onKeyDown={(e) => handleTextPartKeyDown(e, index)}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': {
                        border: 'none',
                      },
                      padding: 0,
                      '& textarea': {
                        padding: '8px',
                      },
                    },
                    backgroundColor: 'transparent',
                    mb: index < msg.contentParts.length - 1 && msg.contentParts[index + 1]?.type === 'text' ? 0.5 : 0,
                  }}
                />
              )
            }
            return null
          })}
          {msg.contentParts.filter((part) => part.type === 'text').length === 0 && (
            <TextField
              className="w-full"
              autoFocus={!isSmallScreen}
              multiline
              minRows={5}
              maxRows={15}
              placeholder="prompt"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setMsg({
                    contentParts: [{ type: 'text', text: e.target.value }],
                  })
                }
              }}
              id={`${msg.id}-input`}
              onKeyDown={onKeyDown}
              sx={{
                '& .MuiOutlinedInput-root': {
                  '& fieldset': {
                    border: 'none',
                  },
                  padding: 0,
                  '& textarea': {
                    padding: '8px',
                  },
                },
                backgroundColor: 'transparent',
              }}
            />
          )}
        </Box>
        {!isSmallScreen && (
          <Typography variant="caption" style={{ opacity: 0.3 }}>
            {t('[Ctrl+Enter] Save, [Ctrl+Shift+Enter] Save and Resend')}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={onSaveAndReply}>{t('Save & Resend')}</Button>
        <Button onClick={onSave}>{t('save')}</Button>
      </DialogActions>
    </Dialog>
  )
})

export default MessageEdit
