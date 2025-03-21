import { Message } from 'src/shared/types'
import { ApiError, ChatboxAIAPIError } from './errors'
import Base, { onResultChange } from './base'

interface Options {
    arkApiKey: string
    arkBaseURL: string
    arkModel: ArkModel | 'custom-model'
    arkEndpointId: string
    temperature: number
    topP: number
}

export default class VolcArk extends Base {
    public name = 'VolcengineArk'

    public options: Options
    constructor(options: Options) {
        super()
        this.options = options
        this.options.arkBaseURL = this.options.arkBaseURL || 'https://ark.cn-beijing.volces.com/api/v3'
    }

    async callChatCompletion(
        rawMessages: Message[],
        signal?: AbortSignal,
        onResultChange?: onResultChange
    ): Promise<string> {
        try {
            return await this._callChatCompletion(rawMessages, signal, onResultChange)
        } catch (e) {
            if (
                e instanceof ApiError &&
                e.message.includes('Invalid content type. image_url is only supported by certain models.')
            ) {
                throw ChatboxAIAPIError.fromCodeName('model_not_support_image', 'model_not_support_image')
            }
            throw e
        }
    }

    async _callChatCompletion(
        rawMessages: Message[],
        signal?: AbortSignal,
        onResultChange?: onResultChange
    ): Promise<string> {
        const model = this.options.arkEndpointId

        rawMessages = injectModelSystemPrompt(rawMessages)

        const messages = await populateGPTMessage(rawMessages)
        return this.requestChatCompletionsStream(
            {
                messages,
                model,
                max_tokens: undefined,
                temperature: this.options.temperature,
                top_p: this.options.topP,
                stream: true,
            },
            signal,
            onResultChange
        )
    }

    async requestChatCompletionsStream(
        requestBody: Record<string, any>,
        signal?: AbortSignal,
        onResultChange?: onResultChange
    ): Promise<string> {
        const apiPath = '/chat/completions'
        const response = await this.post(`${this.options.arkBaseURL}${apiPath}`, this.getHeaders(), requestBody, signal)
        let result = ''
        await this.handleSSE(response, (message) => {
            if (message === '[DONE]') {
                return
            }
            const data = JSON.parse(message)
            if (data.error) {
                throw new ApiError(`Error from OpenAI: ${JSON.stringify(data)}`)
            }
            const text = data.choices[0]?.delta?.content
            if (text !== undefined) {
                result += text
                if (onResultChange) {
                    onResultChange(result)
                }
            }
        })
        return result
    }

    async requestChatCompletionsNotStream(
        requestBody: Record<string, any>,
        signal?: AbortSignal,
        onResultChange?: onResultChange
    ): Promise<string> {
        const apiPath = '/chat/completions'
        const response = await this.post(`${this.options.arkBaseURL}${apiPath}`, this.getHeaders(), requestBody, signal)
        const json = await response.json()
        if (json.error) {
            throw new ApiError(`Error from OpenAI: ${JSON.stringify(json)}`)
        }
        if (onResultChange) {
            onResultChange(json.choices[0].message.content)
        }
        return json.choices[0].message.content
    }

    getHeaders() {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.options.arkApiKey}`,
            'Content-Type': 'application/json',
        }
        return headers
    }
}

export const arkModelConfigs = {
    'doubao-1.5-pro-256k': {
        maxTokens: 12_288,
        maxContextTokens: 131_072,
    },
    'doubao-1.5-pro-32k': {
        maxTokens: 12_288,
        maxContextTokens: 32_768,
    },
    'doubao-1.5-vision-pro-32k': {
        maxTokens: 12_288,
        maxContextTokens: 32_768,
    },
    'deepseek-r1': {
        maxTokens: 8192,
        maxContextTokens: 64_000,
    },
    'deepseek-v3': {
        maxTokens: 8192,
        maxContextTokens: 64_000,
    },
}
export type ArkModel = keyof typeof arkModelConfigs
export const models = Array.from(Object.keys(arkModelConfigs)).sort() as ArkModel[]

export async function populateGPTMessage(rawMessages: Message[]): Promise<OpenAIMessage[]> {
    const messages: OpenAIMessage[] = rawMessages.map((m) => ({
        role: m.role,
        content: m.content,
    }))
    return messages
}

export function injectModelSystemPrompt(messages: Message[]) {
    const metadataPrompt = `
Current date: ${new Date().toISOString()}

`
    let hasInjected = false
    return messages.map((m) => {
        if (m.role === 'system' && !hasInjected) {
            m = { ...m }
            m.content = metadataPrompt + m.content
            hasInjected = true
        }
        return m
    })
}

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
    name?: string
}
