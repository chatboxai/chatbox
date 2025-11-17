import { Configuration, OpenAIApi, ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum } from './openai-node'
import { Message } from './types'

export async function replay(apiKey: string, host: string, msgs: Message[], onText?: (text: string) => void, onError?: (error: Error) => void) {
    if (msgs.length === 0) {
        throw new Error('No messages to replay')
    }
    const head = msgs[0]
    msgs = msgs.slice(1)


    const maxLen = 1800
    let totalLen = head.content.length

    let prompts: Message[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (msg.content.length + totalLen > maxLen) {
            break
        }
        prompts = [msg, ...prompts]
        totalLen += msg.content.length
    }
    prompts = [head, ...prompts]

    try {
        const messages: ChatCompletionRequestMessage[] = prompts.map(msg => ({ role: msg.role, content: msg.content }))
        const response = await fetch(`${host}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages,
                model: "gpt-3.5-turbo",
                stream: true
            })
        });
        
        // Check response status before trying to read the stream
        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`
            try {
                const errorData = await response.json()
                if (errorData.error) {
                    errorMessage = errorData.error.message || errorMessage
                }
            } catch {
                // If we can't parse the error, use the status text
            }
            throw new Error(errorMessage)
        }
        
        if (!response.body) {
            throw new Error('No response body')
        }
        const reader = response.body.getReader();
        const d = new TextDecoder('utf8');
        let fullText = ''
        let partialData = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            } else {
                const raw = d.decode(value)
                if (partialData == '') {
                    partialData = raw
                } else {
                    partialData += raw;
                }
                const delimiterIndex = partialData.indexOf('\n\n');
                if (delimiterIndex === -1) {
                    continue;
                }
                let items = partialData.split('\n\n')
                partialData = ''
                items = items.map(item => item.replace(/^data: /, '')).filter(item => item.length > 0).filter(item => item !== '[DONE]')
                const datas = items.map(item => {
                    let json: any
                    try {
                        json = JSON.parse(item)
                    } catch (error) {
                        throw new Error(`Error parsing item: ${item}.\nError Details: ${error}`)
                    }
                    if (json.error) {
                        throw new Error(`Error from OpenAI: ${JSON.stringify(json)}`)
                    }
                    return json
                })
                for (const data of datas) {
                    const text = data.choices[0]?.delta?.content
                    if (text !== undefined) {
                        fullText += text
                        if (onText) {
                            onText(fullText)
                        }
                    }
                }
            }
        }
        return fullText
    } catch (error) {
        if (onError) {
            onError(error)
        }
        throw error
    }
}
