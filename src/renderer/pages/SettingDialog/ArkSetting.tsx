import { Typography, Box } from '@mui/material'
import { ModelSettings } from '../../../shared/types'
import { useTranslation } from 'react-i18next'
import { Accordion, AccordionSummary, AccordionDetails } from '../../components/Accordion'
import TemperatureSlider from '../../components/TemperatureSlider'
import TopPSlider from '../../components/TopPSlider'
import PasswordTextField from '../../components/PasswordTextField'
import MaxContextMessageCountSlider from '../../components/MaxContextMessageCountSlider'
import ArkModelSelect from '../../components/ArkModelSelect'
import TextFieldReset from '@/components/TextFieldReset'

interface ModelConfigProps {
  settingsEdit: ModelSettings
  setSettingsEdit: (settings: ModelSettings) => void
}

export default function VolcArkSetting(props: ModelConfigProps) {
  const { settingsEdit, setSettingsEdit } = props
  const { t } = useTranslation()
  return (
    <Box>
      <PasswordTextField
        label={t('api key')}
        value={settingsEdit.arkApiKey}
        setValue={(value) => {
          setSettingsEdit({ ...settingsEdit, arkApiKey: value })
        }}
        placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
      />
      <>
        <TextFieldReset
          margin="dense"
          label={t('Base URL')}
          type="text"
          fullWidth
          variant="outlined"
          value={settingsEdit.arkBaseURL}
          placeholder="https://ark.cn-beijing.volces.com/api/v3"
          defaultValue='https://ark.cn-beijing.volces.com/api/v3'
          onValueChange={(value) => {
            value = value.trim()
            if (value.length > 4 && !value.startsWith('http')) {
              value = 'https://' + value
            }
            setSettingsEdit({ ...settingsEdit, arkBaseURL: value })
          }}
        />
      </>
      <ArkModelSelect
        arkModel={settingsEdit.arkModel}
        arkEndpointId={settingsEdit.arkEndpointId}
        onChange={(arkModel, arkEndpointId) =>
          setSettingsEdit({ ...settingsEdit, arkModel, arkEndpointId })
        }
      />
      <Accordion>
        <AccordionSummary aria-controls="panel1a-content">
          <Typography>
            {t('token')}{' '}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
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
