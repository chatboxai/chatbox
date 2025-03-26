import OpenAI from './openai'
import { Settings, Config, ModelProvider, SessionType } from '../../../shared/types'
import ChatboxAI from './chatboxai'
import Ollama from './ollama'
import SiliconFlow from './siliconflow'
import LMStudio from './lmstudio'
import Claude from './claude'
import PPIO from './ppio'


export function getModel(setting: Settings, config: Config) {
    switch (setting.aiProvider) {
        case ModelProvider.ChatboxAI:
            return new ChatboxAI(setting, config)
        case ModelProvider.OpenAI:
            return new OpenAI(setting)
        case ModelProvider.LMStudio:
            return new LMStudio(setting)
        case ModelProvider.Claude:
            return new Claude(setting)
        case ModelProvider.Ollama:
            return new Ollama(setting)
        case ModelProvider.SiliconFlow:
            return new SiliconFlow(setting)
        case ModelProvider.PPIO:
            return new PPIO(setting)
        default:
            throw new Error('Cannot find model with provider: ' + setting.aiProvider)
    }
}

export const aiProviderNameHash = {
    [ModelProvider.OpenAI]: 'OpenAI API',
    [ModelProvider.Claude]: 'Claude API',
    [ModelProvider.ChatboxAI]: 'Chatbox AI',
    [ModelProvider.LMStudio]: 'LMStudio',
    [ModelProvider.Ollama]: 'Ollama',
    [ModelProvider.SiliconFlow]: 'SiliconCloud API',
    [ModelProvider.PPIO]: 'PPIO',
}

export const AIModelProviderMenuOptionList = [
    {
        value: ModelProvider.ChatboxAI,
        label: aiProviderNameHash[ModelProvider.ChatboxAI],
        featured: true,
        disabled: false,
    },
    {
        value: ModelProvider.OpenAI,
        label: aiProviderNameHash[ModelProvider.OpenAI],
        disabled: false,
    },
    {
        value: ModelProvider.Claude,
        label: aiProviderNameHash[ModelProvider.Claude],
        disabled: false,
    },
    {
        value: ModelProvider.Ollama,
        label: aiProviderNameHash[ModelProvider.Ollama],
        disabled: false,
    },
    {
        value: ModelProvider.LMStudio,
        label: aiProviderNameHash[ModelProvider.LMStudio],
        disabled: false,
    },
    {
        value: ModelProvider.SiliconFlow,
        label: aiProviderNameHash[ModelProvider.SiliconFlow],
        disabled: false,
    },
    {
        value: ModelProvider.PPIO,
        label: aiProviderNameHash[ModelProvider.PPIO],
        disabled: false,
    },
]

export function getModelDisplayName(settings: Settings, sessionType: SessionType): string {
    if (!settings) {
        return 'unknown'
    }
    switch (settings.aiProvider) {
        case ModelProvider.OpenAI:
            if (settings.model === 'custom-model') {
                let name = settings.openaiCustomModel || ''
                if (name.length >= 10) {
                    name = name.slice(0, 10) + '...'
                }
                return `OpenAI Custom Model (${name})`
            }
            return settings.model || 'unknown'
        case ModelProvider.Claude:
            return settings.claudeModel || 'unknown'
        case ModelProvider.ChatboxAI:
            const model = settings.chatboxAIModel || 'chatboxai-3.5'
            return model.replace('chatboxai-', 'Chatbox AI ')
        case ModelProvider.Ollama:
            return `Ollama (${settings.ollamaModel})`
        case ModelProvider.LMStudio:
            return `LMStudio (${settings.lmStudioModel})`
        case ModelProvider.SiliconFlow:
            return `SiliconCloud (${settings.siliconCloudModel})`
        case ModelProvider.PPIO:
            return `PPIO (${settings.ppioModel})`
        default:
            return 'unknown'
    }
}
