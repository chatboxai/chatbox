import { Select, MenuItem, FormControl, InputLabel, TextField } from '@mui/material'
import { ModelSettings } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'

export interface Props {
    model: ModelSettings['ppioModel']
    ppioHost: string
    onChange(model: string): void
    className?: string
}

export default function PPIOModelSelect(props: Props) {
    const { t } = useTranslation()
    const [models, setModels] = useState<string[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchModels = async () => {
            try {
                const response = await fetch(`${props.ppioHost}/models`)
                const data = await response.json()
                if (data.data) {
                    const modelIds = data.data.map((m: any) => m.id)
                    setModels(modelIds)
                }
            } catch (error) {
                console.error('Failed to fetch PPIO models:', error)
            } finally {
                setLoading(false)
            }
        }
        fetchModels()
    }, [props.ppioHost])

    return (
        <FormControl fullWidth variant="outlined" margin="dense" className={props.className}>
            <InputLabel htmlFor="model-select">{t('model')}</InputLabel>
            <Select
                label={t('model')}
                id="model-select"
                value={props.model}
                onChange={(e) => props.onChange(e.target.value)}
                disabled={loading}
            >
                {models.map((model) => (
                    <MenuItem key={model} value={model}>
                        {model}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    )
} 