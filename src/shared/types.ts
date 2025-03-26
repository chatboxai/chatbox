import { v4 as uuidv4 } from 'uuid'
import { Model } from '../renderer/packages/models/openai'
import * as siliconflow from '../renderer/packages/models/siliconflow'
import { ClaudeModel } from '../renderer/packages/models/claude'

export const MessageRoleEnum = {
    System: 'system',
    User: 'user',
    Assistant: 'assistant',
} as const

export type MessageRole = (typeof MessageRoleEnum)[keyof typeof MessageRoleEnum]

export interface Message {
    id: string

    role: MessageRole
    content: string
    name?: string

    cancel?: () => void
    generating?: boolean

    aiProvider?: ModelProvider
    model?: string

    errorCode?: number
    error?: string
    errorExtra?: {
        [key: string]: any
    }

    wordCount?: number
    tokenCount?: number
    tokensUsed?: number
    timestamp?: number
}

export type SettingWindowTab = 'ai' | 'display' | 'chat' | 'advanced'

export type SessionType = 'chat'

export function isChatSession(session: Session) {
    return session.type === 'chat' || !session.type
}

export interface Session {
    id: string
    type?: SessionType
    name: string
    picUrl?: string
    messages: Message[]
    copilotId?: string
}

export function createMessage(role: MessageRole = MessageRoleEnum.User, content: string = ''): Message {
    return {
        id: uuidv4(),
        content: content,
        role: role,
        timestamp: new Date().getTime(),
    }
}

export enum ModelProvider {
    ChatboxAI = 'chatbox-ai',
    OpenAI = 'openai',
    Claude = 'claude',
    Ollama = 'ollama',
    SiliconFlow = 'silicon-flow',
    LMStudio = 'lm-studio',
    PPIO = 'ppio',
}

export interface ModelSettings {
    aiProvider: ModelProvider

    // openai
    openaiKey: string
    apiHost: string
    model: Model | 'custom-model'
    openaiCustomModel?: string

    //LMStudio
    lmStudioHost: string
    lmStudioModel: string

    // claude
    claudeApiKey: string
    claudeApiHost: string
    claudeModel: ClaudeModel

    // azure
    azureEndpoint: string
    azureDeploymentName: string
    azureDalleDeploymentName: string
    azureApikey: string

    // chatglm-6b
    chatglm6bUrl: string

    // chatbox-ai
    licenseKey?: string
    chatboxAIModel?: ChatboxAIModel
    licenseInstances?: {
        [key: string]: string
    }
    licenseDetail?: ChatboxAILicenseDetail

    // ollama
    ollamaHost: string
    ollamaModel: string

    // siliconflow
    siliconCloudHost: string
    siliconCloudKey: string
    siliconCloudModel: siliconflow.Model | 'custom-model'

    // ppio
    ppioHost: string
    ppioKey: string
    ppioModel: string

    temperature: number
    topP: number
    openaiMaxContextMessageCount: number
}

export interface Settings extends ModelSettings {
    showWordCount?: boolean
    showTokenCount?: boolean
    showTokenUsed?: boolean
    showModelName?: boolean
    showMessageTimestamp?: boolean

    theme: Theme
    language: Language
    languageInited?: boolean
    fontSize: number
    spellCheck: boolean

    defaultPrompt?: string

    proxy?: string

    allowReportingAndTracking: boolean

    userAvatarKey?: string

    enableMarkdownRendering: boolean

    autoGenerateTitle: boolean
}

export type Language = 'en' | 'zh-Hans' | 'zh-Hant' | 'ja' | 'ko' | 'ru' | 'de' | 'fr' | 'es'

export interface Config {
    uuid: string
}

export interface SponsorAd {
    text: string
    url: string
}

export interface SponsorAboutBanner {
    type: 'picture' | 'picture-text'
    name: string
    pictureUrl: string
    link: string
    title: string
    description: string
}

export interface CopilotDetail {
    id: string
    name: string
    picUrl?: string
    prompt: string
    demoQuestion?: string
    demoAnswer?: string
    starred?: boolean
    usedCount: number
    shared?: boolean
}

export interface Toast {
    id: string
    content: string
}

export enum Theme {
    DarkMode,
    LightMode,
    FollowSystem,
}

export interface RemoteConfig {
    setting_chatboxai_first: boolean
    product_ids: number[]
}

export interface ChatboxAILicenseDetail {
    type: ChatboxAIModel
    name: string
    defaultModel: ChatboxAIModel
    remaining_quota_35: number
    remaining_quota_4: number
    remaining_quota_image: number
    image_used_count: number
    image_total_quota: number
    token_refreshed_time: string
    token_expire_time: string | null | undefined
}

export type ChatboxAIModel = 'chatboxai-3.5' | 'chatboxai-4'
