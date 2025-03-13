import { Message } from 'src/shared/types'
import { ApiError } from './errors'
import Base, { onResultChange } from './base'
import { siliconflowModelConfigs } from '@/packages/models/siliconflow'

export interface Options {
    apiKey: string
    baseURL: string
    model?: string
    temperature: number
    topP: number
}

export default class OpenAIComp extends Base {

    public options: Options
    constructor(options: Options) {
        super()
        this.options = options
    }

    async callChatCompletion(
        rawMessages: Message[],
        signal?: AbortSignal,
        onResultChange?: onResultChange
    ): Promise<string> {
        const messages = rawMessages.map((m) => ({
            role: m.role,
            content: m.content,
        }))

        const response = await this.post(
            `${this.options.baseURL}/chat/completions`,
            this.getHeaders(),
            {
                messages,
                model: this.options.model,
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
                throw new ApiError(`Error from PPIO: ${JSON.stringify(data)}`)
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

    public async listModels(): Promise<string[]> {
        const res = await this.get(`${this.options.baseURL}/models`, this.getHeaders())
        const json = await res.json()
        if (!json['data']) {
            throw new ApiError(JSON.stringify(json))
        }
        return json['data'].map((m: any) => m['id'])
    }

    getHeaders() {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
        }
        return headers
    }

    async get(url: string, headers: Record<string, string>) {
        const res = await fetch(url, {
            method: 'GET',
            headers,
        })
        if (!res.ok) {
            const err = await res.text().catch((e) => null)
            throw new ApiError(`Status Code ${res.status}, ${err}`)
        }
        return res
    }
}