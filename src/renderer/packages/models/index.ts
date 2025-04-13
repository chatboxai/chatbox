import { Settings, Config, ModelProvider, OpenAICompProviderSettings } from '../../../shared/types'
import OpenAIComp from '@/packages/models/openai-comp'


export function getModel(setting: Settings, provider?: OpenAICompProviderSettings, modelName?: string) {

    if (provider) {
        return new OpenAIComp({
            apiKey: provider.apiKey,
            baseURL: provider.baseURL,
            model: modelName ? modelName : provider.selectedModel,
            temperature: provider.temperature,
            topP: provider.topP,
        })
    }

    if (setting.modelProvider !== ""){
        const modelProvider = setting.modelProviderList.find((m) => m.name === setting.modelProvider);
        if (!modelProvider){
            return null
        }
        return new OpenAIComp({
            apiKey: modelProvider.apiKey,
            baseURL: modelProvider.baseURL,
            model: modelProvider.selectedModel,
            temperature: modelProvider.temperature,
            topP: modelProvider.topP,
        })
    }
    throw new Error('please select model provider!')
}

export const aiProviderNameHash = {
    [ModelProvider.OpenAI]: 'OpenAI API',
    [ModelProvider.Claude]: 'Claude API',
    [ModelProvider.ChatboxAI]: 'Chatbox AI',
    [ModelProvider.LMStudio]: 'LMStudio',
    [ModelProvider.Ollama]: 'Ollama',
    [ModelProvider.SiliconFlow]: 'SiliconCloud API',
    [ModelProvider.PPIO]: 'PPIO',
    [ModelProvider.DeepInfra]: 'Deep Infra',
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
    {
        value: ModelProvider.DeepInfra,
        label: aiProviderNameHash[ModelProvider.DeepInfra],
    }
]

export function getModelName(settings: Settings) {
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
                return `${name}`
            }
            return settings.model || 'unknown'
        case ModelProvider.Claude:
            return settings.claudeModel || 'unknown'
        case ModelProvider.ChatboxAI:
            const model = settings.chatboxAIModel || 'chatboxai-3.5'
            return model.replace('chatboxai-', 'Chatbox AI ')
        case ModelProvider.Ollama:
            return `${settings.ollamaModel}`
        case ModelProvider.LMStudio:
            return `${settings.lmStudioModel}`
        case ModelProvider.SiliconFlow:
            return `${settings.siliconCloudModel}`
        case ModelProvider.PPIO:
            return `${settings.ppioModel}`
        case ModelProvider.DeepInfra:
            if (settings.model === 'custom-model') {
                let name = settings.deepInfraCustomModel
                return `${name}`
            }
            return `${settings.deepInfraModel}` || 'unknown'
        default:
            return 'unknown'
    }
}

export function getModelDisplayName(settings: Settings): string {
    const { modelProvider, modelProviderList } = settings ?? {};

    const isValidProvider = modelProvider?.trim() && modelProviderList?.length;
    if (!isValidProvider) return 'unknown';

    const selectedProvider = modelProviderList.find(m => m.name === modelProvider);
    return selectedProvider?.selectedModel ?? 'unknown';
}
