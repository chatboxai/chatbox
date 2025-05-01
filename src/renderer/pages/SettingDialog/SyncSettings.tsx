import {
    AppBar,
    Box,
    Button,
    Checkbox,
    FormControl,
    FormControlLabel,
    FormGroup,
    IconButton,
    MenuItem,
    Select,
    SelectChangeEvent,
    Switch,
    Toolbar,
    Typography,
    Chip,
    Divider, useTheme, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material'
import { useState } from 'react'
import {
    SyncDataType,
    SyncFrequencyList,
    SyncProvider,
    SyncProviderEnum,
    SyncProviderList
} from '../../../shared/types'
import { models } from '@/packages/models/openai'
import { settingsAtom } from '@/stores/atoms'
import { useAtom } from 'jotai'
import DropboxLogin from '@/pages/Sync/DropboxLogin'
import { Dropbox } from '@/packages/synchronization/dropbox'
import { useTranslation } from 'react-i18next'
import platform from '@/packages/platform'


interface Props {}

export default function SyncSettings  (props :Props) {
    const theme = useTheme()
    const {t} = useTranslation()

    const [settingsEdit, setSettingsEdit] = useAtom(settingsAtom)

    // State management
    const [selectedProvider, setSelectedProvider] = useState(settingsEdit.syncConfig.provider);
    const [isConnected, setIsConnected] = useState(false);
    const [syncInterval, setSyncInterval] = useState(settingsEdit.syncConfig.frequency);
    const [syncOnLaunch, setSyncOnLaunch] = useState(true);
    const [selectedData, setSelectedData] = useState({
        all: true,
        chat: true,
        config: true,
    });
    const [dropboxOpen, setDropboxOpen] = useState(false);
    const [showRestartDialog, setShowRestartDialog] = useState(false);

    const handleProviderChange = (event: SelectChangeEvent) => {
        const provider = event.target.value;
        setSelectedProvider(provider as SyncProvider);
        settingsEdit.syncConfig.provider = provider as SyncProvider;
        const providerConfig = settingsEdit.syncConfig?.providersConfig
        if (providerConfig) {
           switch (provider) {
               case 'Dropbox':
                   setIsConnected(providerConfig.Dropbox.authToken?.trim() !== '');
                   break
               default:
                   setIsConnected(false);
           }
        }
    };

    // Handler for data type selection
    const handleDataChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = event.target;
        if (name === 'all') {
            setSelectedData({
                all: checked,
                chat: checked,
                config: checked,
            });
            settingsEdit.syncConfig.syncDataType = checked ? ['all'] : [];
        } else {
            setSelectedData(prev => {
                // Create the new state first
                const newState = {
                    ...prev,
                    [name]: checked,
                    all: Object.values({ ...prev, [name]: checked }).every(Boolean)
                };

                // Calculate syncDataType based on the NEW state
                settingsEdit.syncConfig.syncDataType = Object.entries(newState)
                    .filter(([key, value]) => value && key !== 'all') // Exclude 'all' and unchecked items
                    .map(([key]) => key);

                return newState;
            });
        }
    };

    const handleConnectButton = (event: React.ChangeEvent<HTMLInputElement>) => {
        switch (settingsEdit.syncConfig.provider){
            case 'Dropbox':
                setDropboxOpen(true);
                break
            default:
                setDropboxOpen(false);
                break;
        }
    }

    return (
        <Box>
            <Box sx={{ p: 1 }}>
                <Dialog open={showRestartDialog}>
                    <DialogTitle title={t('Restart Confirmation')}/>
                    <DialogContent>
                        {t('Changing sync interval require restart to implement, do u want to restart immediately?')}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={()=> { setShowRestartDialog(false)}}>{t('Later')}</Button>
                        <Button onClick={()=> {platform.relaunch()}} >{t('Restart Immediately')}</Button>
                    </DialogActions>
                </Dialog>
                <DropboxLogin open={dropboxOpen} setOpen={setDropboxOpen}/>
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
                    Cloud Provider
                </Typography>
                <FormControl fullWidth sx={{ mb: 1 }}>
                    <Select
                        value={selectedProvider}
                        onChange={handleProviderChange}
                        displayEmpty
                    >
                        {SyncProviderList.map((provider) => (
                            <MenuItem key={provider} value={provider}>
                                {provider}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {selectedProvider !== 'None' && (
                    <Button variant="contained" onClick={handleConnectButton} fullWidth>
                        {isConnected ? 'Reconnect' : 'Connect'} to {selectedProvider.replace('-', ' ')}
                    </Button>
                )}


                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
                    Sync Frequency
                </Typography>
                <FormControl fullWidth sx={{ mb: 1 }}>
                    <Select
                        value={syncInterval}
                        onChange={(e: any) => {
                            setSyncInterval(e.target.value)
                            settingsEdit.syncConfig.frequency = e.target.value as number
                            setShowRestartDialog(true)
                        }}
                    >
                        <MenuItem key={'disabled'} value={0}>
                           Disabled
                        </MenuItem>
                        {Object.entries(SyncFrequencyList).map((syncFrequency) => (
                            <MenuItem key={syncFrequency[0]} value={syncFrequency[1]}>
                                {syncFrequency[0]}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <Divider sx={{ my: 2 }} />

                {/* Auto-Sync Toggle */}
                <FormControlLabel
                    control={
                        <Switch
                            checked={syncOnLaunch}
                            onChange={(e) => {
                                setSyncOnLaunch(e.target.checked)
                                settingsEdit.syncConfig.onAppLaunch = e.target.checked
                            }}
                            color="primary"
                        />
                    }
                    label="Sync on app launch"
                    labelPlacement="start"
                    sx={{ justifyContent: 'space-between', width: '100%', m: 0 }}
                />

                <Divider sx={{ my: 2 }} />

                {/* Data Selection */}
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
                    Sync Data Types
                </Typography>

                <FormGroup>
                    {Object.entries(SyncDataType).map(([key, value]) => (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    name={value}
                                    checked={selectedData[value]}
                                    onChange={handleDataChange}
                                />
                            }
                            label={key}
                        />
                    ))}
                </FormGroup>
            </Box>
        </Box>
    )
};
