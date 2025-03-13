import { Box, Divider } from '@mui/material'
import { ModelProvider, ModelSettings } from '../../../shared/types'
import OpenAISetting from './OpenAISetting'
import ChatboxAISetting from './ChatboxAISetting'
import AIProviderSelect from '../../components/AIProviderSelect'
import { OllamaHostInput, OllamaModelSelect } from './OllamaSetting'
import { LMStudioHostInput, LMStudioModelSelect } from './LMStudioSetting'
import SiliconFlowSetting from './SiliconFlowSetting'
import MaxContextMessageCountSlider from '@/components/MaxContextMessageCountSlider'
import TemperatureSlider from '@/components/TemperatureSlider'
import ClaudeSetting from './ClaudeSetting'
import PPIOSetting from './PPIOSetting'
import DeepInfraSetting from '@/pages/SettingDialog/DeepInfraSetting'
import OpenAICompModelSelect from '@/components/OpenAICompModelSelect'
import * as React from 'react'

interface ModelConfigProps {
    settingsEdit: ModelSettings
    setSettingsEdit: (settings: ModelSettings) => void
}

export default function ModelSettingTab(props: ModelConfigProps) {
    const [modalAddAIProvider, setModalAddAIProvider] = React.useState(false);

    const { settingsEdit, setSettingsEdit } = props
    return (
        <Box>
            <AIProviderSelect settings={settingsEdit} setSettings={setSettingsEdit} openModalAddAIProvider={setModalAddAIProvider} />
            {settingsEdit.aiProvider !== 'openai-compatible' && (
                <Divider sx={{ marginTop: '10px', marginBottom: '24px' }} />
            )}

            <OpenAICompModelSelect
                open={modalAddAIProvider}
                onClose={function (): void {
                    setModalAddAIProvider(false)
                }}
                onSave={function (settings: {
                    providerName: string
                    baseUrl: string
                    apiKey: string
                    selectedModel: string
                }): void {
                    throw new Error('Function not implemented.')
                }}
            />

            {settingsEdit.aiProvider === ModelProvider.OpenAI && (
                <OpenAISetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
            )}
            {settingsEdit.aiProvider === ModelProvider.ChatboxAI && (
                <ChatboxAISetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
            )}
            {settingsEdit.aiProvider === ModelProvider.Ollama && (
                <>
                    <OllamaHostInput
                        ollamaHost={settingsEdit.ollamaHost}
                        setOllamaHost={(v) => setSettingsEdit({ ...settingsEdit, ollamaHost: v })}
                    />
                    <OllamaModelSelect
                        ollamaModel={settingsEdit.ollamaModel}
                        setOlamaModel={(v) => setSettingsEdit({ ...settingsEdit, ollamaModel: v })}
                        ollamaHost={settingsEdit.ollamaHost}
                    />
                    <MaxContextMessageCountSlider
                        value={settingsEdit.openaiMaxContextMessageCount}
                        onChange={(v) => setSettingsEdit({ ...settingsEdit, openaiMaxContextMessageCount: v })}
                    />
                    <TemperatureSlider
                        value={settingsEdit.temperature}
                        onChange={(v) => setSettingsEdit({ ...settingsEdit, temperature: v })}
                    />
                </>
            )}

            {settingsEdit.aiProvider === ModelProvider.LMStudio && (
                <>
                    <LMStudioHostInput
                        LMStudioHost={settingsEdit.lmStudioHost}
                        setLMStudioHost={(v) => setSettingsEdit({ ...settingsEdit, lmStudioHost: v })}
                    />
                    <LMStudioModelSelect
                        LMStudioModel={settingsEdit.lmStudioModel}
                        setLMStudioModel={(v) => setSettingsEdit({ ...settingsEdit, lmStudioModel: v })}
                        LMStudioHost={settingsEdit.lmStudioHost}
                    />
                    <MaxContextMessageCountSlider
                        value={settingsEdit.openaiMaxContextMessageCount}
                        onChange={(v) => setSettingsEdit({ ...settingsEdit, openaiMaxContextMessageCount: v })}
                    />
                    <TemperatureSlider
                        value={settingsEdit.temperature}
                        onChange={(v) => setSettingsEdit({ ...settingsEdit, temperature: v })}
                    />
                </>
            )}

            {settingsEdit.aiProvider === ModelProvider.DeepInfra && (
                <DeepInfraSetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
            )}

            {settingsEdit.aiProvider === ModelProvider.SiliconFlow && (
                <SiliconFlowSetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
            )}
            {settingsEdit.aiProvider === ModelProvider.Claude && (
                <ClaudeSetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
            )}
            {settingsEdit.aiProvider === ModelProvider.PPIO && (
                <PPIOSetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
            )}
        </Box>
    )
}
