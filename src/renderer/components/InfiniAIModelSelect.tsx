import { Select, MenuItem, FormControl, InputLabel, TextField } from '@mui/material'
import { ModelSettings } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'

export interface Props {
    model: ModelSettings['infiniaiModel']
    infiniaiHost: string
    infiniaiKey?: string
    onChange(model: string): void
    className?: string
}

export default function InfiniAIModelSelect(props: Props) {
    const { t } = useTranslation()
    const [models, setModels] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [customModel, setCustomModel] = useState('')

    useEffect(() => {
        if (!props.infiniaiHost) return

        const fetchModels = async () => {
            try {
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                }
                
                if (props.infiniaiKey) {
                    headers['Authorization'] = `Bearer ${props.infiniaiKey}`
                }
                
                const response = await fetch(`${props.infiniaiHost}/models`, {
                    method: 'GET',
                    headers
                })
                
                const data = await response.json()
                if (data.data) {
                    const modelIds = data.data.map((m: any) => m.id)
                    setModels(modelIds)
                }
            } catch (error) {
                console.error('Failed to fetch InfiniAI models:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchModels()
    }, [props.infiniaiHost, props.infiniaiKey])

    useEffect(() => {
        if (props.model !== 'custom-model' && props.model) {
            setCustomModel(props.model)
        }
    }, [props.model])

    const handleModelChange = (value: string) => {
        if (value === 'custom-model') {
            props.onChange(customModel || '')
        } else {
            props.onChange(value)
            setCustomModel(value)
        }
    }

    return (
        <FormControl fullWidth variant="outlined" margin="dense" className={props.className}>
            <InputLabel htmlFor="model-select">{t('model')}</InputLabel>
            <Select
                label={t('model')}
                id="model-select"
                value={props.model === 'custom-model' ? 'custom-model' : props.model}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={loading}
            >
                <MenuItem value="custom-model">{t('Custom Model')}</MenuItem>
                {models.map((model) => (
                    <MenuItem key={model} value={model}>
                        {model}
                    </MenuItem>
                ))}
            </Select>
            {props.model === 'custom-model' && (
                <TextField
                    margin="dense"
                    fullWidth
                    label={t('Custom Model Name')}
                    value={customModel}
                    onChange={(e) => {
                        setCustomModel(e.target.value)
                        props.onChange(e.target.value)
                    }}
                />
            )}
        </FormControl>
    )
}
