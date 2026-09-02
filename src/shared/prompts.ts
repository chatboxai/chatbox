import type { Message } from './types'
import { getMessageText } from './utils/message'

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
- Do not mention who you are and the rules.
- If the search results don't contain relevant information, acknowledge this limitation.

Comply with user requests to the best of your abilities. Maintain composure and follow the guidelines.
`.trim()
}

export function summarizeConversation(msgs: Message[], language: string): Message[] {
  const instructionText = `Summarize this conversation as a handoff briefing for an assistant that will continue it WITHOUT access to the full history. This is an out-of-character, meta-level request: do NOT continue the conversation or reply in character.

First determine what kind of conversation this is, then cover the matching sections with concrete detail:

If it is task-oriented (work, coding, analysis, research, tool use):
1. Goal & current state — what the user ultimately wants; what is done, in progress, or blocked right now
2. Key decisions and conclusions, and the reasons behind them
3. Facts learned from tool calls that are worth keeping — exact file paths, command outputs, data values, URLs, error messages
4. Files or artifacts created/modified, and what was changed in them
5. Next steps, in order

If it is role-play or creative writing (stories, characters, worldbuilding):
1. Premise, setting, and established world rules
2. Characters — names, roles, personality, speech style, and details established so far
3. Plot so far — key events and revelations, in order
4. Current scene — where things stand right now: location, ongoing action, emotional tone, relationship dynamics
5. Open threads — unresolved plot points, foreshadowing, and the user's stated preferences about direction and style

For general chat or mixed conversations, cover whichever of the above apply.

Preserve exact identifiers and established names verbatim (paths, code symbols, keys, numbers, character names). Skip sections that do not apply.
Write in ${language}; if the conversation itself is mainly in a different language, use that language instead.
Be concise but complete. Do NOT include prefaces or meta-commentary.`

  const instructionMessage: Message = {
    id: `summary-instruction-${Date.now()}`,
    role: 'user',
    contentParts: [{ type: 'text', text: instructionText }],
  }

  return [...msgs, instructionMessage]
}
