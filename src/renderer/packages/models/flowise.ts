import { Message } from "src/shared/types";
import Base, { onResultChange } from "./base";
import { FlowiseClient } from "flowise-sdk";
import { ApiError } from "@/packages/models/errors";
import { Exception } from "sass";
import * as sessionActions from "@/stores/sessionActions";

interface Options {
    flowiseHost: string
    flowiseChatflowId: string
    temperature: number
    topP: number
}

export default class Flowise extends Base {
    public name = 'Flowise'
    private sessionId = sessionActions.getCurrentSession().id
    public options: Options
    constructor(options: Options) {
        super()
        this.options = options
        this.options.flowiseHost = this.options.flowiseHost || 'http://localhost:3000'
    }

    async callChatCompletion(messages: Message[], signal?: AbortSignal, onResultChange?: onResultChange): Promise<string> {

        const client = new FlowiseClient({ baseUrl: this.options.flowiseHost});
        let result = ''
        try {
            // For streaming prediction
            const prediction = await client.createPrediction({
                chatflowId: this.options.flowiseChatflowId,
                question: messages[messages.length - 1].content,
                streaming: true,
                overrideConfig:{
                    sessionId: this.sessionId,
                }
            });
            for await (const chunk of prediction) {
                /*
                 event: start, token, metadata, end
                 */
                if (chunk.event === "start" || chunk.event === "token") {
                    result += chunk.data
                    onResultChange && onResultChange(result)
                } else if (chunk.event === "metadata"){
                    // const res = JSON.parse(JSON.stringify(chunk.data))
                    // do nothing
                }
            }

        } catch (error) {
            console.error('Error:', error);
            throw new ApiError((error as Exception).message)
        }
        return result
    }

    async listModels(): Promise<string[]> {
        // Flowise doesn't have a models API, so we return an empty array
        return []
    }
} 