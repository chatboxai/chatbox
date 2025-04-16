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
    Divider, useTheme
} from '@mui/material'
import { useState } from 'react'
import { SyncFrequencyList, SyncProvider, SyncProviderEnum, SyncProviderList } from '../../../shared/types'
import { models } from '@/packages/models/openai'
import { settingsAtom } from '@/stores/atoms'
import { useAtom } from 'jotai'


interface Props {}

export default function SyncSettings  (props :Props) {
    const theme = useTheme()

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
        theme: true
    });

    // Handler for provider selection
    const handleProviderChange = (event: SelectChangeEvent) => {
        const provider = event.target.value;
        setSelectedProvider(provider as SyncProvider);
        settingsEdit.syncConfig.provider = provider
        // Mock connection check
        setIsConnected(provider === 'google-drive');
    };

    // Handler for data type selection
    const handleDataChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = event.target;
        if (name === 'all') {
            setSelectedData({
                all: checked,
                chat: checked,
                config: checked,
                theme: checked
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

    console.log(settingsEdit.syncConfig);

    return (
        <Box>
            <Box sx={{ p: 1 }}>
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
                    !isConnected ? (
                        <Button variant="contained" fullWidth>
                            Connect to {selectedProvider.replace('-', ' ')}
                        </Button>
                    ) : (
                        <Chip label="Connected" color="success" variant="outlined" />
                    )
                )}


                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
                    Sync Frequency
                </Typography>
                <FormControl fullWidth sx={{ mb: 1 }}>
                    <Select
                        value={syncInterval}
                        onChange={(e) => {
                            setSyncInterval(e.target.value)
                            settingsEdit.syncConfig.frequency = e.target.value
                        }}
                    >
                        <MenuItem key={'disabled'} value={-1}>
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
                    <FormControlLabel
                        control={
                            <Checkbox
                                name="all"
                                checked={selectedData.all}
                                onChange={handleDataChange}
                            />
                        }
                        label="All"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                name="chat"
                                checked={selectedData.chat}
                                onChange={handleDataChange}
                            />
                        }
                        label="Chat"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                name="config"
                                checked={selectedData.config}
                                onChange={handleDataChange}
                            />
                        }
                        label="Config"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                name="theme"
                                checked={selectedData.theme}
                                onChange={handleDataChange}
                            />
                        }
                        label="Theme"
                    />
                </FormGroup>
            </Box>
        </Box>
    )
};
