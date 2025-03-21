import { Typography, Box, TextField } from '@mui/material'
import { ModelSettings } from '../../../shared/types'
import { useTranslation } from 'react-i18next'
import { Accordion, AccordionSummary, AccordionDetails } from '../../components/Accordion'
import TemperatureSlider from '../../components/TemperatureSlider'
import TopPSlider from '../../components/TopPSlider'
import PasswordTextField from '../../components/PasswordTextField'
import MaxContextMessageCountSlider from '../../components/MaxContextMessageCountSlider'
import InfiniAIModelSelect from '../../components/InfiniAIModelSelect'

interface ModelConfigProps {
    settingsEdit: ModelSettings
    setSettingsEdit: (settings: ModelSettings) => void
}

export default function InfiniAISetting(props: ModelConfigProps) {
    const { settingsEdit, setSettingsEdit } = props
    const { t } = useTranslation()
    return (
        <Box>
            <PasswordTextField
                label={t('api key')}
                value={settingsEdit.infiniaiKey}
                setValue={(value) => {
                    setSettingsEdit({ ...settingsEdit, infiniaiKey: value })
                }}
                placeholder="sk_xxxxxxxxxxxxxxxxxxxxxxxx"
            />
            
            <TextField
                label={t('API Host')}
                fullWidth
                margin="dense"
                value={settingsEdit.infiniaiHost || 'https://api.infiniai.com/v1'}
                onChange={(e) => {
                    setSettingsEdit({ ...settingsEdit, infiniaiHost: e.target.value })
                }}
                placeholder="https://api.infiniai.com/v1"
            />
            
            <Accordion>
                <AccordionSummary aria-controls="panel1a-content">
                    <Typography>
                        {t('model')} & {t('token')}{' '}
                    </Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <InfiniAIModelSelect
                        model={settingsEdit.infiniaiModel}
                        infiniaiHost={settingsEdit.infiniaiHost}
                        infiniaiKey={settingsEdit.infiniaiKey}
                        onChange={(model) =>
                            setSettingsEdit({ ...settingsEdit, infiniaiModel: model })
                        }
                    />
                    <TemperatureSlider
                        value={settingsEdit.temperature}
                        onChange={(value) => setSettingsEdit({ ...settingsEdit, temperature: value })}
                    />
                    <TopPSlider
                        topP={settingsEdit.topP}
                        setTopP={(v) => setSettingsEdit({ ...settingsEdit, topP: v })}
                    />
                    <MaxContextMessageCountSlider
                        value={settingsEdit.openaiMaxContextMessageCount}
                        onChange={(v) => setSettingsEdit({ ...settingsEdit, openaiMaxContextMessageCount: v })}
                    />
                </AccordionDetails>
            </Accordion>
        </Box>
    )
}
