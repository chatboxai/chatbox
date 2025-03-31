import { Message } from '../../shared/types'

export function nameConversation(msgs: Message[], language: string): Message[] {

    const conversationList = msgs.slice(0,5).map((msg)=> {
        return msg.content.
        replace(/<think>[\s\S]*?<\/think>/g, ''). // TODO: tmp solution due to reasoning message.
        slice(0,100) // save tokens
    }).map((msg)=> msg).
    join('\n\n---------\n\n')

    return [
        {
            id: '1',
            role: 'user',
            content: `Based on the chat history, give this conversation a name.
Keep it short - 30 characters max, example "Mars's Distance".
Use ${language}.
Just provide the name, nothing else.

Here's the conversation:

\`\`\`
${conversationList}
\`\`\`

Name this conversation in 30 characters or less.
Use ${language}.
Only give the name, nothing else.

The name is:`,
        },
    ]
}
