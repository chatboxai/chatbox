import { Message } from 'src/shared/types'
import { ApiError, ChatboxAIAPIError } from './errors'
import Base, { onResultChange } from './base'

interface Options {
    siliconCloudKey: string
    apiHost: string
    apiPath?: string
    siliconCloudModel: Model | 'custom-model'
    siliconflowCustomModel?: string
    temperature: number
    topP: number
    openaiCustomModel?: string
}

export default class SiliconFlow extends Base {
    public name = 'SiliconFlow'

    public options: Options
    constructor(options: Options) {
        super()
        this.options = options
        this.options.apiHost = 'https://api.siliconflow.cn'
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
        let messages = await populateSiliconFlowMessage(rawMessages, this.options.siliconCloudModel)

        const model =
            this.options.siliconCloudModel === 'custom-model'
                ? this.options.siliconflowCustomModel || this.options.openaiCustomModel || ''
                : this.options.siliconCloudModel
        messages = injectModelSystemPrompt(model, messages)

        const apiPath = this.options.apiPath || '/v1/chat/completions'
        const response = await this.post(
            `${this.options.apiHost}${apiPath}`,
            this.getHeaders(),
            {
                messages,
                model,
                max_tokens: undefined,
                temperature: this.options.temperature,
                top_p: this.options.topP,
                stream: true,
            },
            signal
        )
        let result = ''
        await this.handleSSE(response, (message) => {
            if (message === '[DONE]') {
                return
            }
            const data = JSON.parse(message)
            if (data.error) {
                throw new ApiError(`Error from SiliconFlow: ${JSON.stringify(data)}`)
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

    getHeaders() {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.options.siliconCloudKey}`,
            'Content-Type': 'application/json',
        }
        return headers
    }
}

// Ref: https://siliconflow.cn/zh-cn/models
export const siliconflowModelConfigs = {
    'Qwen/Qwen2-72B-Instruct': { maxTokens: 32768 },
    'Qwen/Qwen2-Math-72B-Instruct': { maxTokens: 32768 },
    'Qwen/Qwen2-57B-A14B-Instruct': { maxTokens: 32768 },
    'Qwen/Qwen2-7B-Instruct': { maxTokens: 32768 },
    'Qwen/Qwen2-1.5B-Instruct': { maxTokens: 32768 },
    'Qwen/Qwen1.5-110B-Chat': { maxTokens: 32768 },
    'Qwen/Qwen1.5-32B-Chat': { maxTokens: 32768 },
    'Qwen/Qwen1.5-14B-Chat': { maxTokens: 32768 },
    'Qwen/Qwen1.5-7B-Chat': { maxTokens: 32768 },
    'deepseek-ai/DeepSeek-Coder-V2-Instruct': { maxTokens: 32768 },
    'deepseek-ai/DeepSeek-V2-Chat': { maxTokens: 32768 },
    'deepseek-ai/deepseek-llm-67b-chat': { maxTokens: 32768 },
    'THUDM/glm-4-9b-chat': { maxTokens: 32768 },
    'THUDM/chatglm3-6b': { maxTokens: 32768 },
    '01-ai/Yi-1.5-34B-Chat-16K': { maxTokens: 16384 },
    '01-ai/Yi-1.5-9B-Chat-16K': { maxTokens: 16384 },
    '01-ai/Yi-1.5-6B-Chat': { maxTokens: 4096 },
    'internlm/internlm2_5-7b-chat': { maxTokens: 32768 },
    'google/gemma-2-9b-it': { maxTokens: 8192 },
    'google/gemma-2-27b-it': { maxTokens: 8192 },
    'internlm/internlm2_5-20b-chat': { maxTokens: 32768 },
    'meta-llama/Meta-Llama-3.1-8B-Instruct': { maxTokens: 32768 },
    'meta-llama/Meta-Llama-3.1-70B-Instruct': { maxTokens: 32768 },
    'meta-llama/Meta-Llama-3.1-405B-Instruct': { maxTokens: 32768 },
    'meta-llama/Meta-Llama-3-70B-Instruct': { maxTokens: 8192 },
    'mistralai/Mistral-7B-Instruct-v0.2': { maxTokens: 32768 },
    'mistralai/Mixtral-8x7B-Instruct-v0.1': { maxTokens: 32768 },
}
export type Model = keyof typeof siliconflowModelConfigs
export const models = Array.from(Object.keys(siliconflowModelConfigs)).sort() as Model[]

export async function populateSiliconFlowMessage(
    rawMessages: Message[],
    model: Model | 'custom-model'
): Promise<SiliconFlowMessage[]> {
    return populateSiliconFlowMessageText(rawMessages)
}

export async function populateSiliconFlowMessageText(rawMessages: Message[]): Promise<SiliconFlowMessage[]> {
    const messages: SiliconFlowMessage[] = rawMessages.map((m) => ({
        role: m.role,
        content: m.content,
    }))
    return messages
}

export function injectModelSystemPrompt(model: string, messages: SiliconFlowMessage[]) {
    for (const message of messages) {
        if (message.role === 'system') {
            if (typeof message.content == 'string') {
                message.content = `Current model: ${model}\n\n` + message.content
            }
            break
        }
    }
    return messages
}

export interface SiliconFlowMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
    name?: string
}
