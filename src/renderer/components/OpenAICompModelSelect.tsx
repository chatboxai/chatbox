import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { ModelSettings, OpenAICompProviderSettings } from '../../shared/types'
import { OpenAICompModelConfigure } from '@/components/OpenAICompModelConfigure'
import { v4 as uuid } from 'uuid';

export interface Props {
    open: boolean
    onClose: () => void
    onSave: (settings: OpenAICompProviderSettings) => void
    settings: ModelSettings
    setSettings(value: ModelSettings): void
}

export default function OpenAICompModelSelect(props: Props) {
    const { t } = useTranslation()
    const [error, setError] = useState('')
    const [currentProvider, setCurrentProvider] = useState<OpenAICompProviderSettings>({
        uuid: uuid(),
        apiKey: '',
        baseURL: '',
        lastUpdatedModel: 0,
        modelList: [],
        name: '',
        openaiMaxContextMessageCount: 5000,
        selectedModel: '',
        temperature: 1,
        topP: 1
    });

    const handleSave = () => {
        if (!currentProvider?.baseURL || !currentProvider.apiKey || !currentProvider.name || !currentProvider.modelList) {
            // @ts-ignore
            setError(t('Please fill all fields and select a model'))
            return
        }

        props.onSave(currentProvider)
        props.onClose()
    }

    return (
        <Dialog open={props.open} onClose={props.onClose}  maxWidth="md">
            <DialogTitle>{t('Configure OpenAI-Compatible Provider')}</DialogTitle>
            <DialogContent>
              <OpenAICompModelConfigure
                  provider={currentProvider}
                  setProvider={setCurrentProvider}
              />
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
