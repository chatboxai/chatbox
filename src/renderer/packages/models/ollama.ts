import { Message } from 'src/shared/types'
import Base, { onResultChange } from './base'
import { ApiError } from './errors'
import { log } from 'console'

// import ollama from 'ollama/browser'

interface Options {
    ollamaHost: string
    ollamaModel: string
    temperature: number
}

export default class Ollama extends Base {
    public name = 'Ollama'

    public options: Options
    constructor(options: Options) {
        super()
        this.options = options
    }

    getHost(): string {
        let host = this.options.ollamaHost.trim()
        if (host.endsWith('/')) {
            host = host.slice(0, -1)
        }
        if (!host.startsWith('http')) {
            host = 'http://' + host
        }
        if (host === 'http://localhost:11434') {
            host = 'http://127.0.0.1:11434'
        }
        return host
    }

    async callChatCompletion(rawMessages: Message[], signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {
        const messages = rawMessages.map(m => ({ role: m.role, content: m.content }))
        const res = await this.post(
            `${this.getHost()}/api/chat`,
            {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': '1',
            },
            {
                model: this.options.ollamaModel,
                messages,
                stream: true,
                options: {
                    temperature: this.options.temperature,
                }
            },
            signal,
        )
        let result = ''
        await this.handleNdjson(res, (message) => {
            const data = JSON.parse(message)
            if (data['done']) {
                return
            }
            const word = data['message']?.['content']
            if (! word) {
                throw new ApiError(JSON.stringify(data))
            }
            result += word
            if (onResultChange) {
                onResultChange(result)
            }
        })
        return result
    }

    async listModels(): Promise<string[]> {
        const res = await this.get(`${this.getHost()}/api/tags`, { 'ngrok-skip-browser-warning': '1', })
        const json = await res.json()
        if (! json['models']) {
            throw new ApiError(JSON.stringify(json))
        }
        return json['models'].map((m: any) => m['name'])
    }
}
