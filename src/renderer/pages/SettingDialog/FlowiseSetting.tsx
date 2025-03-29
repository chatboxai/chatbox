import { Box } from "@mui/material";
import { ModelSettings } from "../../../shared/types";
import { useTranslation } from "react-i18next";
import TextFieldReset from "@/components/TextFieldReset";
import { useAtomValue } from "jotai";
import { languageAtom } from "@/stores/atoms";
import PasswordTextField from "@/components/PasswordTextField";

interface ModelConfigProps {
    settingsEdit: ModelSettings
    setSettingsEdit: (settings: ModelSettings) => void
}

export function FlowiseSetting(props: ModelConfigProps) {
    const { settingsEdit, setSettingsEdit } = props
    const { t } = useTranslation()

    const language = useAtomValue(languageAtom)
    return (
        <Box>
            <TextFieldReset
                label={t('api host')}
                value={settingsEdit.flowiseHost}
                placeholder='http://localhost:3000'
                defaultValue='http://localhost:3000'
                onValueChange={(value) => {
                    value = value.trim()
                    if (value.length > 4 && !value.startsWith('http')) {
                        value = 'https://' + value
                    }
                    setSettingsEdit({ ...settingsEdit, flowiseHost: value })
                }}
                fullWidth
            />
            <PasswordTextField
              label='ChatFlow ID'
              value={settingsEdit.flowiseChatflowId}
              setValue={(value) => {
                  setSettingsEdit({ ...settingsEdit, flowiseChatflowId: value })
              }}
              placeholder="1bb1e111-xxxx-xxxx-xxxx-xxxxxxxxxxxxxxxx"
            />
        </Box>
    )
}
