import {
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    TextField,
    IconButton,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useTranslation } from 'react-i18next'
import PasswordTextField from '@/components/PasswordTextField'
import { useState } from 'react'
import OpenAIComp from '@/packages/models/openai-comp'

export interface Props {
    open: boolean
    onClose: () => void
    onSave: (settings: {
        providerName: string
        baseUrl: string
        apiKey: string
        selectedModel: string
    }) => void
}

export default function OpenAICompModelSelect(props: Props) {
    const { t } = useTranslation()
    const [providerName, setProviderName] = useState('')
    const [baseUrl, setBaseUrl] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [modelList, setModelList] = useState<string[]>([])
    const [error, setError] = useState('')

    const handleRefresh = async () => {
        setError('')
        if (!baseUrl || !apiKey || !providerName) {
            setError(t('Please provide Provider Name, Base URL, and API Key'))
            return
        }

        try {
            const api = new OpenAIComp({
                baseURL: baseUrl,
                apiKey: apiKey,
                temperature: 0,
                topP: 0
            })

            const res = await api.listModels()
            setModelList(res)
        } catch (err) {
            setError(t('Failed to fetch models: ') + err.message)
            console.error('Error fetching models:', err)
        }
    }

    const handleSave = () => {
        if (!providerName || !baseUrl || !apiKey || !selectedModel) {
            setError(t('Please fill all fields and select a model'))
            return
        }

        props.onSave({
            providerName,
            baseUrl,
            apiKey,
            selectedModel
        })
        props.onClose()
    }

    return (
        <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="md">
            <DialogTitle>{t('Configure OpenAI-Compatible Provider')}</DialogTitle>
            <DialogContent>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <TextField
                    margin="dense"
                    label={t('Provider Name')}
                    fullWidth
                    variant="outlined"
                    value={providerName}
                    placeholder="Open AI"
                    onChange={(e) => setProviderName(e.target.value)}
                />
                <TextField
                    margin="dense"
                    label={t('Base URL')}
                    fullWidth
                    variant="outlined"
                    value={baseUrl}
                    placeholder="https://api.deepinfra.com/v1/openai"
                    onChange={(e) => setBaseUrl(e.target.value)}
                />
                <div style={{
                    display: 'flex',
                    gap: 8,
                    marginTop: 8,
                    alignItems: 'center'
                }}>
                    <PasswordTextField
                        label={t('API Key')}
                        value={apiKey}
                        setValue={setApiKey}
                        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                    <IconButton
                        onClick={handleRefresh}
                        size="large"
                        sx={{
                            border: 1,
                            borderRadius: 1,
                            borderColor: 'divider',
                            height: '54px'
                        }}
                    >
                        <RefreshIcon />
                    </IconButton>
                </div>

                <FormControl fullWidth style={{ marginTop: 8 }}>
                    <InputLabel>{t('Model List')}</InputLabel>
                    <Select
                        label={t('Model List')}
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={modelList.length === 0}
                    >
                        {modelList.map((model) => (
                            <MenuItem key={model} value={model}>
                                {model}
                            </MenuItem>
                        ))}
                        <MenuItem value="custom-model">
                            {t('Custom Model')}
                        </MenuItem>
                    </Select>
                </FormControl>
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose}>{t('Cancel')}</Button>
                <Button onClick={handleSave} variant="contained" color="primary">
                    {t('Save')}
                </Button>
            </DialogActions>
        </Dialog>
    )
}
