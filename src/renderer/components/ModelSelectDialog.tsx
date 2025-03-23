import React, { useState } from 'react';
import {
    TextField,
    List,
    ListItem,
    ListItemText,
    IconButton,
    Box,
    Popover,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { OpenAICompModel, Settings } from '../../shared/types'
import { useAtom } from 'jotai'
import { settingsAtom } from '@/stores/atoms'
import { settings } from '../../shared/defaults'
interface Props {
    open: boolean;
    onClose: () => void;
    settings: Settings;
}
export function ModelSelectDialog(props: Props) {
    // States for popover, search, and selected model
    const [anchorEl, setAnchorEl] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedModel, setSelectedModel] = useState('');

    const handleSelectModel = (selectedModel:OpenAICompModel ) => {
        setSelectedModel(selectedModel.id)
        props.settings.modelProviderList = props.settings.modelProviderList.map(provider =>
            provider.uuid === props.settings.modelProviderID
                ? { ...provider, selectedModel: selectedModel.id }
                : provider
        )
        props.onClose();
    }

    const handleClose = () => {
        setAnchorEl(null);
    };

    const open = Boolean(anchorEl);
    const filteredModels = props.settings.modelProviderList?.find((provider) =>
       provider.uuid === props.settings.modelProviderID
    )?.modelList?.filter(model =>  model.id.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
        <div>
            {/* Popover for the overlay */}
            <Popover
                open={props.open}
                onClose={props.onClose}
                anchorReference="anchorPosition"
                anchorPosition={{ top: 60, left: 55 }}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'left'
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'left'
                }}
                PaperProps={{
                    sx: (theme) => ({
                        width: 300,
                        maxHeight: 400,
                        overflowY: 'auto',
                        p: 1,
                        boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                        border:'0 4px 8px rgba(0,0,0,0.2)',
                    })
                }}
            >
                {/* Search input */}
                <Box sx={{ mb: 1 }}>
                    <TextField
                        fullWidth
                        variant="outlined"
                        placeholder="Search a model"
                        size="small"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </Box>

                {/* Scrollable list of models */}
                <List sx={{ p: 0 }}>
                    {filteredModels?.map((model) => (
                        <ListItem
                            key={model.id}
                            onClick={() => handleSelectModel(model)}
                            selected={selectedModel === model.id}
                            sx={{
                                // Example of selected item styling
                                '&.Mui-selected': {
                                    backgroundColor: '#f0f0f0'
                                },
                                '&.Mui-selected:hover': {
                                    backgroundColor: '#e0e0e0'
                                }
                            }}
                        >
                            <ListItemText primary={model.id} />
                            {selectedModel === model.id && (
                                <IconButton edge="end" disableRipple>
                                    <CheckIcon />
                                </IconButton>
                            )}
                        </ListItem>
                    ))}
                </List>
            </Popover>
        </div>
    );
}
