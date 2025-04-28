import React, { useEffect } from 'react'
import {
    Button,
    Dialog,
    DialogContent,
    DialogActions,
    DialogTitle,
    DialogContentText,
    TextField,
    Select,
    FormControl,
    InputLabel,
    SelectChangeEvent,
    MenuItem,
    Autocomplete,
} from '@mui/material'
import {
    Session,
    createMessage, Settings
} from '../../shared/types'
import { useTranslation } from 'react-i18next'
import * as sessionActions from '../stores/sessionActions'
import * as atoms from '../stores/atoms'
import { useAtom } from 'jotai'
import { trackingEvent } from '@/packages/event'
import { settingsAtom } from '../stores/atoms'

interface Props {
}

export default function ChatConfigWindow(props: Props) {
    const { t } = useTranslation()
    const [chatConfigDialogSession, setChatConfigDialogSession] = useAtom(atoms.chatConfigDialogAtom)
    const [settings, setSettings] = useAtom(settingsAtom)
    const [settingsEdit, setSettingsEdit] =  React.useState<Settings | null>(settings)

    const [editingData, setEditingData] = React.useState<Session | null>(chatConfigDialogSession)
    useEffect(() => {
        if (!chatConfigDialogSession) {
            setEditingData(null)
        } else {
            setEditingData({
                ...chatConfigDialogSession,
            })
        }
    }, [chatConfigDialogSession])

    useEffect(() => {
        if (!settings) {
            setSettingsEdit(null)
        } else {
            setSettingsEdit({
                ...settings,
            })
        }
    }, [settings])

    const [systemPrompt, setSystemPrompt] = React.useState('')
    useEffect(() => {
        if (!chatConfigDialogSession) {
            setSystemPrompt('')
        } else {
            const systemMessage = chatConfigDialogSession.messages.find((m) => m.role === 'system')
            setSystemPrompt(systemMessage?.content || '')
        }
    }, [chatConfigDialogSession])

    useEffect(() => {
        if (chatConfigDialogSession) {
            trackingEvent('chat_config_window', { event_category: 'screen_view' })
        }
    }, [chatConfigDialogSession])

    const onCancel = () => {
        setChatConfigDialogSession(null)
        setEditingData(null)
    }
    const onSave = () => {
        if (!chatConfigDialogSession || !editingData) {
            return
        }
        if (editingData.name === '') {
            editingData.name = chatConfigDialogSession.name
        }
        editingData.name = editingData.name.trim()
        if (systemPrompt === '') {
            editingData.messages = editingData.messages.filter((m) => m.role !== 'system')
        } else {
            const systemMessage = editingData.messages.find((m) => m.role === 'system')
            if (systemMessage) {
                systemMessage.content = systemPrompt.trim()
            } else {
                editingData.messages.unshift(createMessage('system', systemPrompt.trim()))
            }
        }
        sessionActions.modify(editingData)
        setChatConfigDialogSession(null)
    }

    if (!chatConfigDialogSession || !editingData) {
        return null
    }

    const handleModelProviderChange = (event: SelectChangeEvent) => {
        setEditingData({
            ...editingData,
            modelProviderID: event.target.value,
            model: '',
        })
    };


    return (
        <Dialog open={!!chatConfigDialogSession} onClose={onCancel} fullWidth>
            <DialogTitle>{t('Conversation Settings')}</DialogTitle>
            <DialogContent>
                <DialogContentText></DialogContentText>
                <TextField
                    margin="dense"
                    label={t('name')}
                    type="text"
                    fullWidth
                    variant="outlined"
                    value={editingData.name}
                    onChange={(e) => setEditingData({ ...editingData, name: e.target.value })}
                />
                <div className='mt-1'>
                    <TextField
                        margin="dense"
                        label={t('Instruction (System Prompt)')}
                        placeholder={t('Copilot Prompt Demo') || ''}
                        fullWidth
                        variant="outlined"
                        multiline
                        minRows={2}
                        maxRows={8}
                        value={systemPrompt}
                        onChange={(event) => setSystemPrompt(event.target.value)}
                    />
                </div>
                <div className='mt-1'>
                    <FormControl fullWidth margin="dense">
                        <InputLabel id="model-provider">Model Provider</InputLabel>
                        <Select
                            labelId="model-provider"
                            id="demo-simple-select-helper"
                            value={editingData.modelProviderID}
                            label="Model Provider"
                            onChange={handleModelProviderChange}
                        >
                            {settingsEdit?.modelProviderList.map((provider) => (
                                <MenuItem 
                                value={provider.uuid}
                                selected={provider.uuid === editingData.modelProviderID}
                                >
                                    {provider.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </div>
                <div className='mt-2'>
                    <Autocomplete
                        freeSolo
                        id="model-select"
                        disableClearable
                        options={settingsEdit?.modelProviderList.find(p => p.uuid === editingData.modelProviderID)?.modelList?.map(m=> m.id) || []}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label="Select Model"
                                slotProps={{
                                    input: {
                                        ...params.InputProps,
                                        type: 'search',
                                    },
                                }}
                            />
                        )}
                        value={editingData.model || ''}
                        onChange={(event, newValue) => {
                            setEditingData({
                                ...editingData,
                                model: newValue
                            })
                        }}
                    />
                </div>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel}>{t('cancel')}</Button>
                <Button onClick={onSave}>{t('save')}</Button>
            </DialogActions>
        </Dialog>
    )
}
