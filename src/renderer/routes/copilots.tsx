import { ConfirmDeleteMenuItem } from '@/components/ConfirmDeleteButton'
import Page from '@/components/Page'
import StyledMenu from '@/components/StyledMenu'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import * as remote from '@/packages/remote'
import platform from '@/platform'
import * as atoms from '@/stores/atoms'
import * as sessionActions from '@/stores/sessionActions'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
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
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { CopilotDetail, Message } from '../../shared/types'
import { createSession } from '@/stores/sessionStorageMutations'

export const Route = createFileRoute('/copilots')({
  component: Copilots,
})

function Copilots() {
  const [open, setOpen] = useAtom(atoms.openCopilotDialogAtom)
  const navigate = useNavigate()

  const { t } = useTranslation()

  const store = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilots()

  const createChatSessionWithCopilot = async (copilot: CopilotDetail) => {
    const msgs: Message[] = []
    msgs.push({ id: uuidv4(), role: 'system', contentParts: [{ type: 'text', text: copilot.prompt }] })
    if (copilot.demoQuestion) {
      msgs.push({
        id: uuidv4(),
        role: 'user',
        contentParts: [{ type: 'text', text: copilot.demoQuestion }],
      })
    }
    if (copilot.demoAnswer) {
      msgs.push({
        id: uuidv4(),
        role: 'assistant',
        contentParts: [{ type: 'text', text: copilot.demoAnswer }],
      })
    }
    const newSession = await createSession({
      name: copilot.name,
      type: 'chat',
      picUrl: copilot.picUrl,
      messages: msgs,
      starred: false,
      copilotId: copilot.id,
    })
    sessionActions.switchCurrentSession(newSession.id)
    trackingEvent('create_copilot_conversation', { event_category: 'user' })
  }
  const handleClose = () => {
    setOpen(false)
  }

  const useCopilot = (detail: CopilotDetail) => {
    const newDetail = { ...detail, usedCount: (detail.usedCount || 0) + 1 }
    if (newDetail.shared) {
      remote.recordCopilotShare(newDetail)
    }
    store.addOrUpdate(newDetail)
    // createChatSessionWithCopilot(newDetail)
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
          <Button
            variant="outlined"
            startIcon={<AddCircleOutlineIcon />}
            onClick={() => {
              getEmptyCopilot().then(setCopilotEdit)
            }}
          >
            {t('Create New Copilot')}
          </Button>
        )}
        <ScrollableTabsButtonAuto
          values={[{ value: 'my', label: t('My Copilots') }]}
          currentValue="my"
          onChange={() => {}}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            width: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {list.map((item, ix) => (
            <MiniItem
              key={`${item.id}_${ix}`}
              mode="local"
              detail={item}
              useMe={() => useCopilot(item)}
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
        </div>

        <ScrollableTabsButtonAuto
          values={[
            {
              value: 'chatbox-featured',
              label: t('Chatbox Featured'),
            },
          ]}
          currentValue="chatbox-featured"
          onChange={() => {}}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            width: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {remoteCopilots?.map((item, ix) => (
            <MiniItem key={`${item.id}_${ix}`} mode="remote" detail={item} useMe={() => useCopilot(item)} />
          ))}
        </div>
      </div>
    </Page>
  )
}

type MiniItemProps =
  | {
      mode: 'local'
      detail: CopilotDetail
      useMe(): void
      switchStarred(): void
      editMe(): void
      deleteMe(): void
    }
  | {
      mode: 'remote'
      detail: CopilotDetail
      useMe(): void
    }

function MiniItem(props: MiniItemProps) {
  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)
  const useCopilot = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    if (open) {
      return
    }
    props.useMe()
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
        padding: '5px',
        margin: '5px',
        cursor: 'pointer',
        '.edit-icon': {
          opacity: 0,
        },
        '&:hover .edit-icon': {
          opacity: 1,
        },
      }}
      className="w-full sm:w-48 hover:bg-slate-400/25 border-solid border-slate-400/20 rounded-md"
      onClick={useCopilot}
    >
      <Avatar sizes="30px" sx={{ width: '30px', height: '30px' }} src={props.detail.picUrl}></Avatar>
      <div
        style={{
          marginLeft: '5px',
        }}
        className="w-full sm:w-28"
      >
        <Typography variant="body1" noWrap>
          {props.detail.name}
        </Typography>
      </div>

      {props.mode === 'local' && (
        <>
          <div
            style={{
              width: '30px',
              height: '10px',
              marginLeft: '2px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <IconButton onClick={openMenu}>
              {props.detail.starred ? (
                <StarIcon color="primary" fontSize="small" />
              ) : (
                <MoreHorizOutlinedIcon className="edit-icon" color="primary" fontSize="small" />
              )}
            </IconButton>
          </div>
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

interface TabsProps {
  currentValue: string
  values: { value: string; label: string }[]
  onChange(value: string): void
}
function ScrollableTabsButtonAuto(props: TabsProps) {
  return (
    <Box sx={{ marginTop: '14px' }}>
      <Tabs
        component="a"
        value={props.currentValue}
        onChange={(event, newValue) => {
          props.onChange(newValue)
        }}
        variant="scrollable"
        scrollButtons={false}
      >
        {props.values.map((item) => (
          <Tab key={item.value} label={item.label} value={item.value} />
        ))}
      </Tabs>
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
        helperText={helperTexts['name']}
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
        helperText={helperTexts['prompt']}
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
            onChange={(e, checked) => setCopilotEdit({ ...copilotEdit, shared: checked })}
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
