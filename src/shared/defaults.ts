import {
    Theme,
    Config,
    Settings,
    ModelProvider,
    Session,
    OpenAICompProviderSettings,
    OpenAICompModel,
    SyncProvider,
    SynchronizedConfig,
    SyncFrequencyList,
} from './types'
import { v4 as uuidv4 } from 'uuid'
import SyncSettings from '@/pages/SettingDialog/SyncSetting2'

export function settings(): Settings {
    return {
        modelProvider: '',
        modelProviderID: '',
        modelProviderList: getDefaultModelProviders(),
        deepInfraCustomModel: '',
        deepInfraHost: '',
        deepInfraKey: '',
        deepInfraModel: '',
        aiProvider: ModelProvider.OpenAI,
        openaiKey: '',
        apiHost: 'https://api.openai.com',

        azureApikey: '',
        azureDeploymentName: '',
        azureDalleDeploymentName: 'dall-e-3',
        azureEndpoint: '',
        chatglm6bUrl: '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        topP: 1,
        // openaiMaxTokens: 0,
        // openaiMaxContextTokens: 4000,
        openaiMaxContextMessageCount: 10,
        // maxContextSize: "4000",
        // maxTokens: "2048",

        claudeApiKey: '',
        claudeApiHost: 'https://api.anthropic.com',
        claudeModel: 'claude-3-5-sonnet-20241022',

        ollamaHost: 'http://127.0.0.1:11434',
        ollamaModel: '',

        lmStudioHost: 'http://127.0.0.1:1234',
        lmStudioModel: '',

        showWordCount: true,
        showTokenCount: false,
        showTokenUsed: true,
        showModelName: true,
        showMessageTimestamp: false,
        userAvatarKey: '',
        theme: Theme.DarkMode,
        language: 'en',
        fontSize: 12,
        spellCheck: true,

        defaultPrompt: getDefaultPrompt(),

        allowReportingAndTracking: true,

        enableMarkdownRendering: true,

        siliconCloudHost: 'https://api.siliconflow.cn',
        siliconCloudKey: '',
        siliconCloudModel: 'THUDM/glm-4-9b-chat',

        ppioHost: 'https://api.ppinfra.com/v3/openai',
        ppioKey: '',
        ppioModel: 'deepseek/deepseek-r1/community',

        autoGenerateTitle: true,
        syncConfig: defaultSyncConfig(),
    }
}

export function newConfigs(): Config {
    return { uuid: uuidv4() }
}

export function getDefaultPrompt() {
    return 'You are a helpful assistant. You can help me by answering my questions. You can also ask me questions.'
}

export function sessions(): Session[] {
    return [{ id: uuidv4(), name: 'Untitled', messages: [], type: 'chat' }]
}

export function getDefaultModelProviders(): OpenAICompProviderSettings[] {
    return [
        {
            uuid: uuidv4(),
            name: 'Anthropic',
            baseURL: 'https://api.anthropic.com/v1/',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon: 'https://images.seeklogo.com/logo-png/51/2/anthropic-icon-logo-png_seeklogo-515014.png',
        },
        {
            uuid: uuidv4(),
            name: 'Deepseek',
            baseURL: 'https://api.deepseek.com',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon: 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/deepseek-color.png',
        },
        {
            uuid: uuidv4(),
            name: 'Deepinfra',
            baseURL: 'https://api.deepinfra.com/v1/openai',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon:'https://deepinfra.com/deepinfra-logo-512.webp',
        },
        {
            uuid: uuidv4(),
            name: 'Gemini',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon:'https://lh3.googleusercontent.com/Xtt-WZqHiV8OjACMMMr6wMdoMGE7bABi-HYujupzevufo1kiHUFQZukI1JILhjItrPNrDWLq6pfd=s600-w600',
        },
        {
            uuid: uuidv4(),
            name: 'Grok',
            baseURL: 'https://api.groq.com/openai/v1',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon: 'https://play-lh.googleusercontent.com/dQRKhi30KpzG3gww3TdVLzyIAVuOAWylnAcgnEUxqfpm2A8dEt2sgApVvtKAy-DO8aI',
        },
        {
            uuid: uuidv4(),
            name: 'Open AI',
            baseURL: 'https://api.openai.com',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon:'https://static.vecteezy.com/system/resources/previews/024/558/811/non_2x/openai-chatgpt-logo-icon-free-png.png'
        },
        {
            uuid: uuidv4(),
            name: 'Perplexity',
            baseURL: 'https://api.perplexity.ai',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdFSv1lxsEwowysGSVpPBM_VMwocDGqxqRyg&s',
        },
        {
            uuid: uuidv4(),
            name: 'Siliconflow',
            baseURL: 'https://api.siliconflow.cn/v1',
            temperature: DefaultTemperature,
            topP: DefaultTopP,
            icon:'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/siliconcloud-color.png',
        },
    ] as OpenAICompProviderSettings[]
}

export const DefaultTemperature: number = 1
export const DefaultTopP: number = 0.5

export function defaultSyncConfig(): SynchronizedConfig {
    return <SynchronizedConfig>{
        enabled: false,
        providersConfig: { Dropbox: {} },
        frequency: SyncFrequencyList['5 Minutes'],
        onAppLaunch: true,
        provider: 'None',
        syncDataType: ['all'],
    }
}
