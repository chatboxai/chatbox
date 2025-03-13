import { Select, MenuItem, FormControl, InputLabel, TextField } from '@mui/material'
import { ModelSettings } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { deepInfraModels } from '@/packages/models/deepinfra'

export interface Props {
    model: ModelSettings['deepInfraModel']
    deepInfraCustomModel: ModelSettings['deepInfraCustomModel']
    onChange(model: ModelSettings['deepInfraModel'], deepInfraCustomModel: ModelSettings['deepInfraCustomModel']): void
    className?: string
}

export default function DeepInfraModelSelect(props: Props) {
    const { t } = useTranslation()
    return (
        <FormControl fullWidth variant="outlined" margin="dense" className={props.className}>
            <InputLabel htmlFor="model-select">{t('deepInfraModel')}</InputLabel>
            <Select
                label={t('deepInfraModel')}
                id="model-select"
                value={props.model}
                onChange={(e) => props.onChange(e.target.value as ModelSettings['deepInfraModel'], props.model)}
            >
                {deepInfraModels.map((model) => (
                    <MenuItem key={model} value={model}>
                        {model}
                    </MenuItem>
                ))}
                <MenuItem key="custom-model" value={'custom-model'}>
                    {t('Custom Model')}
                </MenuItem>
            </Select>
            {props.model === 'custom-model' && (
                <TextField
                    margin="dense"
                    label={t('Custom Model Name')}
                    type="text"
                    fullWidth
                    variant="outlined"
                    value={props.deepInfraCustomModel || ''}
                    onChange={(e) =>
                        props.onChange(
                            props.model,  // Keep current model type ('custom-model')
                            e.target.value.trim()  // Update custom model name
                        )
                    }
                />
            )}
        </FormControl>
    )
}
