import { Select, MenuItem, FormControl, InputLabel, TextField } from '@mui/material'
import { ModelSettings } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { models } from '../packages/models/ark'

export interface Props {
  arkModel: ModelSettings['arkModel']
  arkEndpointId: ModelSettings['arkEndpointId']
  onChange(arkModel: ModelSettings['arkModel'], arkEndpointId: ModelSettings['arkEndpointId']): void
  className?: string
}

export default function ArkModelSelect(props: Props) {
  const { t } = useTranslation()
  return (
    <FormControl fullWidth variant="outlined" margin="dense" className={props.className}>
      <InputLabel htmlFor="model-select">{t('model')}</InputLabel>
      <Select
        label={t('model')}
        id="model-select"
        value={props.arkModel}
        onChange={(e) => props.onChange(e.target.value as ModelSettings['arkModel'], props.arkEndpointId)}
      >
        {models.map((model) => (
          <MenuItem key={model} value={model}>
            {model}
          </MenuItem>
        ))}
        <MenuItem key="custom-model" value={'custom-model'}>
          {t('Custom Model')}
        </MenuItem>
      </Select>
      <TextField
        margin="dense"
        label={t('Model or Endpoint')}
        type="text"
        fullWidth
        variant="outlined"
        value={props.arkEndpointId || ''}
        onChange={(e) =>
          props.onChange(props.arkModel, e.target.value.trim())
        }
      />
    </FormControl>
  )
}
