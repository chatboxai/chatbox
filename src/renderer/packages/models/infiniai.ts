import { Message } from 'src/shared/types'
import { ApiError } from './errors'
import Base, { onResultChange } from './base'

interface Options {
    infiniaiKey: string
    infiniaiHost: string
    infiniaiModel: string
    temperature: number
    topP: number
}

export default class InfiniAI extends Base {
    public name = 'InfiniAI'

    public options: Options
    constructor(options: Options) {
        super()
        this.options = options
        this.options.infiniaiHost = this.options.infiniaiHost || 'https://api.infiniai.com/v1'
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
            `${this.options.infiniaiHost}/chat/completions`,
            this.getHeaders(),
            {
                messages,
                model: this.options.infiniaiModel,
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
                throw new ApiError(`Error from InfiniAI: ${JSON.stringify(data)}`)
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

    async listModels(): Promise<string[]> {
        const res = await this.get(`${this.options.infiniaiHost}/models`, this.getHeaders())
        const json = await res.json()
        if (!json['data']) {
            throw new ApiError(JSON.stringify(json))
        }
        return json['data'].map((m: any) => m['id'])
    }

    getHeaders() {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.options.infiniaiKey}`,
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
