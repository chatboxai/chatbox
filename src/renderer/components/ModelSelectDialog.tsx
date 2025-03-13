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
interface Props {
    open: boolean;
    onClose: () => void;
}
export function ModelSelectDialog(props: Props) {
    // Example data
    const modelList = [
        'meta-llama/Meta-Llama-3.1-70B-Instruct',
        'mistralai/Mistral-7B-Instruct-v0.2',
        'google/gemma-2-27b-it',
        'mistralai/Mixtral-8x7B-Instruct-v0.1',
        'meta-llama/Llama-3.3-70B-Instruct',
        'meta-llama/Llama-2-70b-chat-hf',
        'microsoft/WizardLM-2-7B'
    ];

    // States for popover, search, and selected model
    const [anchorEl, setAnchorEl] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedModel, setSelectedModel] = useState('');

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const open = Boolean(anchorEl);

    // Filtered list based on search term
    const filteredModels = modelList.filter((model) =>
        model.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
                    {filteredModels.map((model) => (
                        <ListItem
                            key={model}
                            onClick={() => setSelectedModel(model)}
                            selected={selectedModel === model}
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
                            <ListItemText primary={model} />
                            {selectedModel === model && (
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
