import { Message } from 'src/shared/types'
import Base, { onResultChange } from './base'
import { ApiError } from './errors'
import { get } from 'lodash'

export type ClaudeModel = keyof typeof modelConfig

// https://docs.anthropic.com/claude/docs/models-overview
export const modelConfig = {
    'claude-3-7-sonnet-latest': {
        contextWindow: 200_000,
        maxOutput: 8192,
        vision: true,
    },
    'claude-3-7-sonnet-20250219': {
        contextWindow: 200_000,
        maxOutput: 8192,
        vision: true,
    },
    'claude-3-5-sonnet-latest': {
        contextWindow: 200_000,
        maxOutput: 8192,
        vision: true,
    },
    'claude-3-5-sonnet-20241022': {
        contextWindow: 200_000,
        maxOutput: 8192,
        vision: true,
    },
    'claude-3-5-sonnet-20240620': {
        contextWindow: 200_000,
        maxOutput: 4096,
        vision: true,
    },

    'claude-3-5-haiku-20241022': {
        contextWindow: 200_000,
        maxOutput: 4096,
        vision: true,
    },

    'claude-3-opus-20240229': {
        contextWindow: 200_000,
        maxOutput: 4096,
        vision: true,
    },
    'claude-3-sonnet-20240229': {
        contextWindow: 200_000,
        maxOutput: 4096,
        vision: true,
    },
    'claude-3-haiku-20240307': {
        contextWindow: 200_000,
        maxOutput: 4096,
        vision: true,
    },
    'claude-2.1': {
        contextWindow: 200_000,
        maxOutput: 4096,
        vision: false,
    },
    'claude-2.0': {
        contextWindow: 100_000,
        maxOutput: 4096,
        vision: false,
    },
    'claude-instant-1.2': {
        contextWindow: 100_000,
        maxOutput: 4096,
        vision: false,
    },
}

export const claudeModels: ClaudeModel[] = Object.keys(modelConfig) as ClaudeModel[]

interface Options {
    claudeApiKey: string
    claudeApiHost: string
    claudeModel: ClaudeModel
}

export default class Claude extends Base {
    public name = 'Claude'

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
        rawMessages = this.sequenceMessages(rawMessages)
        let prompt = ''
        const messages: ClaudeMessage[] = []
        for (const msg of rawMessages) {
            if (msg.role === 'system') {
                prompt += msg.content + '\n'
            } else {
                const newMessage: ClaudeMessage = { role: msg.role, content: [] }
                if (msg.content) {
                    newMessage.content.push({ type: 'text', text: msg.content })
                }
                messages.push(newMessage)
            }
        }

        let url = `${this.options.claudeApiHost}/v1/messages`
        const extraHeaders: Record<string, string> = {}

        const response = await this.post(
            url,
            {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': this.options.claudeApiKey,
                ...extraHeaders,
            },
            {
                model: this.options.claudeModel,
                max_tokens: modelConfig[this.options.claudeModel]
                    ? modelConfig[this.options.claudeModel].maxOutput
                    : 4096,
                system: prompt,
                messages: messages,
                stream: true,
            },
            signal
        )
        let result = ''
        await this.handleSSE(response, (message) => {
            const data = JSON.parse(message)
            if (data.error) {
                throw new ApiError(`Error from Claude: ${JSON.stringify(data)}`)
            }
            const word: string = get(data, 'delta.text', '')
            if (word) {
                result += word
                if (onResultChange) {
                    onResultChange(result)
                }
            }
        })
        return result
    }

    public isMessageEmpty(m: Message): boolean {
        return m.content === ''
    }

    public mergeMessages(a: Message, b: Message): Message {
        const ret = { ...a }
        if (ret.content != '') {
            ret.content += '\n\n'
        }
        ret.content += b.content
        return ret
    }

    public sequenceMessages(msgs: Message[]): Message[] {
        // Merge all system messages first
        let system: Message = {
            id: '',
            role: 'system',
            content: '',
        }
        for (let msg of msgs) {
            if (msg.role === 'system') {
                system = this.mergeMessages(system, msg)
            }
        }
        // Initialize the result array with the non-empty system message, if present
        let ret: Message[] = this.isMessageEmpty(system) ? [] : [system]
        let next: Message = {
            id: '',
            role: 'user',
            content: '',
        }
        let isFirstUserMsg = true // Special handling for the first user message
        for (let msg of msgs) {
            // Skip the already processed system messages or empty messages
            if (msg.role === 'system' || this.isMessageEmpty(msg)) {
                continue
            }
            // Merge consecutive messages from the same role
            if (msg.role === next.role) {
                next = this.mergeMessages(next, msg)
                continue
            }
            // Merge all assistant messages as a quote block if constructing the first user message
            if (this.isMessageEmpty(next) && isFirstUserMsg && msg.role === 'assistant') {
                let quote =
                    msg.content
                        .split('\n')
                        .map((line) => `> ${line}`)
                        .join('\n') + '\n'
                msg.content = quote
                next = this.mergeMessages(next, msg)
                continue
            }
            // If not the first user message, add the current message to the result and start a new one
            if (!this.isMessageEmpty(next)) {
                ret.push(next)
                isFirstUserMsg = false
            }
            next = msg
        }
        // Add the last message if it's not empty
        if (!this.isMessageEmpty(next)) {
            ret.push(next)
        }
        // If there's only one system message, convert it to a user message
        if (ret.length === 1 && ret[0].role === 'system') {
            ret[0].role = 'user'
        }
        return ret
    }
}

export interface ClaudeMessage {
    role: 'assistant' | 'user'
    content: (
        | {
            text: string
            type: 'text'
        }
        | {
            type: 'image'
            source: {
                type: 'base64'
                media_type: string
                data: string
            }
        }
    )[]
}
