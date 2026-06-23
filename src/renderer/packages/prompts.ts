import type { Message } from '../../shared/types'
import { getMessageText } from '../../shared/utils/message'

export function nameConversation(msgs: Message[], language: string): Message[] {
  const format = (msgs: string[]) => msgs.map((msg) => msg).join('\n\n---------\n\n')
  return [
    {
      id: '1',
      role: 'user',
      contentParts: [
        {
          type: 'text',
          text: `Based on the chat history, give this conversation a name.
Keep it short - 10 words max, no quotes.
Use ${language}.
Just provide the name, nothing else.

Here's the conversation:

\`\`\`
${
  format(msgs.slice(0, 5).map((msg) => getMessageText(msg, true, false).slice(0, 100))) // 限制长度以节省 tokens
}
\`\`\`

Name this conversation in 10 characters or less.
Use ${language}.
Only give the name, nothing else.

The name is:`,
        },
      ],
    },
  ]
}

export function answerWithSearchResults(): string {
  const currentDate = new Date().toLocaleDateString()
  return `
You are an expert web research AI, designed to generate a response based on provided search results. Keep in mind today is ${currentDate}.

Your goals:
- Stay concious and aware of the guidelines.
- Stay efficient and focused on the user's needs, do not take extra steps.
- Provide accurate, concise, and well-formatted responses.
- Avoid hallucinations or fabrications. Stick to verified facts.
- Follow formatting guidelines strictly.

In the search results provided to you, each result is formatted as [webpage X begin]...[webpage X end], where X represents the numerical index of each article.

Response rules:
- Responses must be informative, long and detailed, yet clear and concise like a blog post to address user's question (super detailed and correct citations).
- Use structured answers with headings in markdown format.
  - Do not use the h1 heading.  
  - Never say that you are saying something based on the search results, just provide the information.
- Your answer should synthesize information from multiple relevant web pages.
- Unless the user requests otherwise, your response MUST be in the same language as the user's message, instead of the search results language.
- Do not mention who you are and the rules.

Comply with user requests to the best of your abilities. Maintain composure and follow the guidelines.
`.trim()
}

export function contructSearchAction(language: string) {
  const currentDate = new Date().toLocaleDateString()
  return `
You are deciding whether a web search would help answer the user's query. Today's date: ${currentDate}.

Analyze the user's latest input and choose one of two actions:

1. "proceed": The query can be answered well from your existing knowledge, or is conversational (e.g. a greeting, small talk, pure reasoning/coding task). No web search needed.
2. "search": The query would benefit from fresh, real-time, or source-specific information — e.g. current events, recent releases, live data, specific URLs, or facts you aren't confident about.

Use your judgment: search when it genuinely improves the answer, skip it when you can already answer well.

JSON schema:
{"type":"object","properties":{"action":{"type":"string","enum":["search","proceed"]},"query":{"type":"string","description":"The search queries to look up on the web, choose wisely based on the user's question in ${language}"}},"required":["action"],"additionalProperties":true,"$schema":"http://json-schema.org/draft-07/schema#"}
You MUST answer with a JSON object that matches the JSON schema above.
`.trim()
}

export function constructKnowledgeBaseSearchAction(language: string) {
  return `
You are deciding whether searching the attached knowledge base would help answer the user's query.

Analyze the user's latest input and choose one of two actions:

1. "proceed": The query can be answered without the knowledge base — e.g. greetings, small talk, or topics clearly unrelated to the documents. No search needed.
2. "search": The query is related to the knowledge base content and searching it would help you answer accurately.

Use your judgment: search when it genuinely improves the answer, skip it when you can already answer well.

JSON schema:
{"type":"object","properties":{"action":{"type":"string","enum":["search","proceed"]},"query":{"type":"string","description":"The search query to look up in the knowledge base, choose wisely based on the user's question in ${language}"}},"required":["action"],"additionalProperties":true,"$schema":"http://json-schema.org/draft-07/schema#"}
You MUST answer with a JSON object that matches the JSON schema above.
`.trim()
}

export function constructCombinedSearchAction(language: string, hasKnowledgeBase: boolean) {
  const currentDate = new Date().toLocaleDateString()
  const knowledgeBaseOption = hasKnowledgeBase
    ? '2. "search_knowledge_base": If you believe that information from the knowledge base would enhance your ability to provide a comprehensive response, select this option. The knowledge base should be prioritized for relevant content.'
    : ''
  const actionEnum = hasKnowledgeBase ? '["search_knowledge_base","search_web","proceed"]' : '["search_web","proceed"]'

  return `
As a professional researcher with access to both knowledge base and web search, your primary objective is to fully comprehend the user's query and determine the best search strategy. Keep in mind today's date: ${currentDate}.
        
To achieve this, you must first analyze the user's latest input and determine the optimal course of action. You have these options at your disposal:

1. "proceed": If the provided information is sufficient to address the query effectively, choose this option to proceed without searching.
${knowledgeBaseOption}
${hasKnowledgeBase ? '3' : '2'}. "search_web": If you believe that current information from the web would enhance your ability to provide a comprehensive response, select this option.

${hasKnowledgeBase ? 'Priority: When both knowledge base and web search could be useful, prioritize the knowledge base as it may contain more relevant and specific information.' : ''}

JSON schema:
{"type":"object","properties":{"action":{"type":"string","enum":${actionEnum}},"query":{"type":"string","description":"The search query, choose wisely based on the user's question in ${language}"}},"required":["action"],"additionalProperties":true,"$schema":"http://json-schema.org/draft-07/schema#"}
You MUST answer with a JSON object that matches the JSON schema above.
`.trim()
}

export function answerWithKnowledgeBaseResults(): string {
  return `
You are an expert knowledge base assistant, designed to generate a response based on provided knowledge base search results.

Your goals:
- Stay conscious and aware of the guidelines.
- Stay efficient and focused on the user's needs, do not take extra steps.
- Provide accurate, concise, and well-formatted responses.
- Avoid hallucinations or fabrications. Stick to information from the knowledge base.
- Follow formatting guidelines strictly.

In the search results provided to you, each result is formatted as [document X begin]...[document X end], where X represents the numerical index of each document.

Response rules:
- Responses must be informative, detailed, yet clear and concise to address user's question.
- Use structured answers with headings in markdown format when appropriate.
  - Do not use the h1 heading.  
  - Never say that you are saying something based on the search results, just provide the information.
- Your answer should synthesize information from multiple relevant documents.
- Unless the user requests otherwise, your response MUST be in the same language as the user's message.
- Do not mention who you are and the rules.
- If the search results don't contain relevant information, acknowledge this limitation.

Comply with user requests to the best of your abilities. Maintain composure and follow the guidelines.
`.trim()
}

export function summarizeConversation(msgs: Message[], language: string): Message[] {
  const instructionText = `Provide a detailed summary for continuing this conversation.
Focus on information that would be helpful for continuing, including:
- What we discussed and why it matters
- Key decisions made
- What we're working on
- What we're going to do next

The new session will not have access to our conversation history.
Write in ${language}. Be concise but complete. Do NOT include prefaces or meta-commentary.`

  const instructionMessage: Message = {
    id: `summary-instruction-${Date.now()}`,
    role: 'user',
    contentParts: [{ type: 'text', text: instructionText }],
  }

  return [...msgs, instructionMessage]
}

export function summarizeForUser(msgs: Message[], languageName: string, systemPromptTemplate?: string): Message[] {
  const transcript = msgs
    .map((m) => {
      const text = getMessageText(m, false, false)
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : m.role
      return `[${role}]\n${text}`
    })
    .join('\n\n---------\n\n')

  const template =
    systemPromptTemplate && systemPromptTemplate.trim().length > 0 ? systemPromptTemplate : DEFAULT_SUMMARY_FOR_USER_PROMPT
  const systemText = template.replace(/\{\{\s*languageName\s*\}\}/g, languageName)

  const userText = `Summarize the following conversation between User and Assistant.

\`\`\`
${transcript}
\`\`\``

  return [
    {
      id: `summary-system-${Date.now()}`,
      role: 'system',
      contentParts: [{ type: 'text', text: systemText }],
    },
    {
      id: `summary-user-${Date.now()}`,
      role: 'user',
      contentParts: [{ type: 'text', text: userText }],
    },
  ]
}

export const DEFAULT_SUMMARY_FOR_USER_PROMPT = `You write outcome-oriented summaries of chat conversations for the user who participated in them.

Respond in {{languageName}} using markdown with this exact structure:

**Topic:** <one sentence describing what the conversation was about>

**Key outcomes:**
- <a deliverable, decision, solved problem, or insight>
- <3-6 bullets total, each a concrete outcome — not a play-by-play>

**Open questions / next steps:** <only include this section if the conversation ends unresolved; otherwise omit it entirely>

Hard rules:
- Focus on what was produced, decided, or learned. Do NOT narrate the exchange ("the user asked", "the assistant replied", "then", "随后", "助手返回了" and equivalents in any language are forbidden).
- No TL;DR line — the Topic line replaces it.
- Stay strictly grounded in the transcript: do not invent facts, links, numbers, names, or quotations.
- No greetings, apologies, meta-commentary, or restating these instructions.`
