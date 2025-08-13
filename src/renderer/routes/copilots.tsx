import { Button as MantineButton, Switch as MantineSwitch } from '@mantine/core'
import EditIcon from '@mui/icons-material/Edit'
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined'
import StarIcon from '@mui/icons-material/Star'
import StarOutlineIcon from '@mui/icons-material/StarOutline'
import {
  Avatar,
  Box,
  Button,
  ButtonGroup,
  Divider,
  FormControlLabel,
  FormGroup,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import { IconPlus } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { ConfirmDeleteMenuItem } from '@/components/ConfirmDeleteButton'
import Page from '@/components/Page'
import StyledMenu from '@/components/StyledMenu'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import * as remote from '@/packages/remote'
import platform from '@/platform'
import * as atoms from '@/stores/atoms'
import type { CopilotDetail } from '../../shared/types'

export const Route = createFileRoute('/copilots')({
  component: Copilots,
})

function Copilots() {
  const [open, setOpen] = useAtom(atoms.openCopilotDialogAtom)
  const [showCopilotsInNewSession, setShowCopilotsInNewSession] = useAtom(atoms.showCopilotsInNewSessionAtom)
  const navigate = useNavigate()

  const { t } = useTranslation()

  const store = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilots()

  const handleClose = () => {
    setOpen(false)
  }

  const selectCopilot = (detail: CopilotDetail) => {
    const newDetail = { ...detail, usedCount: (detail.usedCount || 0) + 1 }
    if (newDetail.shared) {
      remote.recordCopilotShare(newDetail)
    }
    store.addOrUpdate(newDetail)

    navigate({
      to: '/',
      search: {
        copilotId: detail.id,
      },
    })
    handleClose()
  }

  const [copilotEdit, setCopilotEdit] = useState<CopilotDetail | null>(null)
  useEffect(() => {
    if (!open) {
      setCopilotEdit(null)
    } else {
      trackingEvent('copilot_window', { event_category: 'screen_view' })
    }
  }, [open])

  const list = [
    ...store.copilots.filter((item) => item.starred).sort((a, b) => b.usedCount - a.usedCount),
    ...store.copilots.filter((item) => !item.starred).sort((a, b) => b.usedCount - a.usedCount),
  ]

  return (
    <Page title={t('My Copilots')}>
      <div className="p-4 max-w-4xl mx-auto">
        {copilotEdit ? (
          <CopilotForm
            copilotDetail={copilotEdit}
            close={() => {
              setCopilotEdit(null)
            }}
            save={(detail) => {
              store.addOrUpdate(detail)
              setCopilotEdit(null)
            }}
          />
        ) : (
          <>
            {/* Setting Section */}
            <Box sx={{ mb: 3 }}>
              <Typography
                variant="h6"
                sx={{
                  mb: 2,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: (theme) => (theme.palette.mode === 'dark' ? '#fff' : '#212529'),
                }}
              >
                {t('Settings')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <MantineSwitch
                  checked={showCopilotsInNewSession}
                  onChange={(event) => setShowCopilotsInNewSession(event.currentTarget.checked)}
                  label={t('Show Copilots in New Session')}
                />
              </Box>
            </Box>

            {/* My Copilots Section */}
            <Box sx={{ mb: 4 }}>
              <Typography
                variant="h6"
                sx={{
                  mb: 2,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: (theme) => (theme.palette.mode === 'dark' ? '#fff' : '#212529'),
                }}
              >
                {t('My Copilots')}
              </Typography>

              <MantineButton
                variant="light"
                color="blue"
                leftSection={<IconPlus size={20} />}
                mb={16}
                onClick={() => {
                  getEmptyCopilot().then(setCopilotEdit)
                }}
              >
                {t('Create New Copilot')}
              </MantineButton>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 1.5,
                }}
              >
                {list.map((item, ix) => (
                  <MiniItem
                    key={`${item.id}_${ix}`}
                    mode="local"
                    detail={item}
                    selectMe={() => selectCopilot(item)}
                    switchStarred={() => {
                      store.addOrUpdate({
                        ...item,
                        starred: !item.starred,
                      })
                    }}
                    editMe={() => {
                      setCopilotEdit(item)
                    }}
                    deleteMe={() => {
                      store.remove(item.id)
                    }}
                  />
                ))}
              </Box>
            </Box>

            {/* Chatbox Featured Section */}
            <Box>
              <Typography
                variant="h6"
                sx={{
                  mb: 2,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: (theme) => (theme.palette.mode === 'dark' ? '#fff' : '#212529'),
                }}
              >
                {t('Chatbox Featured')}
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 1.5,
                }}
              >
                {remoteCopilots?.map((item, ix) => (
                  <MiniItem key={`${item.id}_${ix}`} mode="remote" detail={item} selectMe={() => selectCopilot(item)} />
                ))}
              </Box>
            </Box>
          </>
        )}
      </div>
    </Page>
  )
}

type MiniItemProps =
  | {
      mode: 'local'
      detail: CopilotDetail
      selectMe(): void
      switchStarred(): void
      editMe(): void
      deleteMe(): void
    }
  | {
      mode: 'remote'
      detail: CopilotDetail
      selectMe(): void
    }

function MiniItem(props: MiniItemProps) {
  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)
  const selectCopilot = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    if (open) {
      return
    }
    props.selectMe()
  }
  const openMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    event.preventDefault()
    setAnchorEl(event.currentTarget)
  }
  const closeMenu = () => {
    setAnchorEl(null)
  }
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        padding: '10px 16px',
        height: '49px',
        cursor: 'pointer',
        borderRadius: '8px',
        border: '1px solid',
        borderColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : '#dee2e6'),
        backgroundColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : '#fff'),
        transition: 'all 0.2s',
        '.edit-icon': {
          opacity: 0,
        },
        '&:hover': {
          borderColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.2)' : '#adb5bd'),
          backgroundColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : '#f8f9fa'),
        },
        '&:hover .edit-icon': {
          opacity: 1,
        },
      }}
      onClick={selectCopilot}
    >
      <Avatar
        sx={{
          width: '28px',
          height: '28px',
          backgroundColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : '#e9ecef'),
        }}
        src={props.detail.picUrl}
      />
      <Box
        sx={{
          marginLeft: '12px',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        <Typography
          variant="body1"
          noWrap
          sx={{
            fontSize: '14px',
            fontWeight: 400,
            color: (theme) => (theme.palette.mode === 'dark' ? '#fff' : '#212529'),
          }}
        >
          {props.detail.name}
        </Typography>
      </Box>

      {props.mode === 'local' && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              marginLeft: 'auto',
            }}
          >
            <IconButton
              onClick={openMenu}
              sx={{
                padding: '4px',
                color: (theme) => (theme.palette.mode === 'dark' ? '#fff' : '#495057'),
              }}
            >
              {props.detail.starred ? (
                <StarIcon fontSize="small" sx={{ color: '#228be6' }} />
              ) : (
                <MoreHorizOutlinedIcon className="edit-icon" fontSize="small" />
              )}
            </IconButton>
          </Box>
          <StyledMenu
            MenuListProps={{
              'aria-labelledby': 'long-button',
            }}
            anchorEl={anchorEl}
            open={open}
            onClose={closeMenu}
          >
            <MenuItem
              key={'star'}
              onClick={() => {
                props.switchStarred()
                closeMenu()
              }}
              disableRipple
            >
              {props.detail.starred ? (
                <>
                  <StarOutlineIcon fontSize="small" />
                  {t('unstar')}
                </>
              ) : (
                <>
                  <StarIcon fontSize="small" />
                  {t('star')}
                </>
              )}
            </MenuItem>

            <MenuItem
              key={'edit'}
              onClick={() => {
                props.editMe()
                closeMenu()
              }}
              disableRipple
            >
              <EditIcon />
              {t('edit')}
            </MenuItem>

            <Divider sx={{ my: 0.5 }} />

            <ConfirmDeleteMenuItem
              onDelete={() => {
                setAnchorEl(null)
                closeMenu()
                props.deleteMe()
              }}
            />
          </StyledMenu>
        </>
      )}
    </Box>
  )
}

interface CopilotFormProps {
  copilotDetail: CopilotDetail
  close(): void
  save(copilotDetail: CopilotDetail): void
  // premiumActivated: boolean
  // openPremiumPage(): void
}

function CopilotForm(props: CopilotFormProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isSmallScreen = useIsSmallScreen()
  const [copilotEdit, setCopilotEdit] = useState<CopilotDetail>(props.copilotDetail)
  useEffect(() => {
    setCopilotEdit(props.copilotDetail)
  }, [props.copilotDetail])
  const [helperTexts, setHelperTexts] = useState({
    name: <></>,
    prompt: <></>,
  })
  const inputHandler = (field: keyof CopilotDetail) => {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setHelperTexts({ name: <></>, prompt: <></> })
      setCopilotEdit({ ...copilotEdit, [field]: event.target.value })
    }
  }
  const save = () => {
    copilotEdit.name = copilotEdit.name.trim()
    copilotEdit.prompt = copilotEdit.prompt.trim()
    if (copilotEdit.picUrl) {
      copilotEdit.picUrl = copilotEdit.picUrl.trim()
    }
    if (copilotEdit.name.length === 0) {
      setHelperTexts({
        ...helperTexts,
        name: <p style={{ color: 'red' }}>{t('cannot be empty')}</p>,
      })
      return
    }
    if (copilotEdit.prompt.length === 0) {
      setHelperTexts({
        ...helperTexts,
        prompt: <p style={{ color: 'red' }}>{t('cannot be empty')}</p>,
      })
      return
    }
    props.save(copilotEdit)
    trackingEvent('create_copilot', { event_category: 'user' })
  }
  return (
    <Box
      sx={{
        marginBottom: '20px',
        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[50],
        padding: '8px',
      }}
    >
      <TextField
        autoFocus={!isSmallScreen}
        margin="dense"
        label={t('Copilot Name')}
        fullWidth
        variant="outlined"
        placeholder={t('My Assistant') || ''}
        value={copilotEdit.name}
        onChange={inputHandler('name')}
        helperText={helperTexts.name}
      />
      <TextField
        margin="dense"
        label={t('Copilot Prompt')}
        placeholder={t('Copilot Prompt Demo') || ''}
        fullWidth
        variant="outlined"
        multiline
        minRows={4}
        maxRows={10}
        value={copilotEdit.prompt}
        onChange={inputHandler('prompt')}
        helperText={helperTexts.prompt}
      />
      <TextField
        margin="dense"
        label={t('Copilot Avatar URL')}
        placeholder="http://xxxxx/xxx.png"
        fullWidth
        variant="outlined"
        value={copilotEdit.picUrl}
        onChange={inputHandler('picUrl')}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <FormGroup row>
          <FormControlLabel
            control={<Switch />}
            label={t('Share with Chatbox')}
            checked={copilotEdit.shared}
            onChange={(_e, checked) => setCopilotEdit({ ...copilotEdit, shared: checked })}
          />
        </FormGroup>
        <ButtonGroup>
          <Button variant="outlined" onClick={() => props.close()}>
            {t('cancel')}
          </Button>
          <Button variant="contained" onClick={save}>
            {t('save')}
          </Button>
        </ButtonGroup>
      </Box>
    </Box>
  )
}

export async function getEmptyCopilot(): Promise<CopilotDetail> {
  const conf = await platform.getConfig()
  return {
    id: `${conf.uuid}:${uuidv4()}`,
    name: '',
    picUrl: '',
    prompt: '',
    starred: false,
    usedCount: 0,
    shared: true,
  }
}
