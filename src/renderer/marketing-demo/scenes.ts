import type { Message, MessageContentParts, MessageFile, MessageToolCallPart } from '@shared/types'
import { MessageRoleEnum } from '@shared/types'
import { DEMO_GEN_IMAGE_1_KEY, DEMO_HERO_IMAGE_KEY } from '@/marketing-demo/demo-assets'
import type { DemoLang, DemoSceneId } from '@/marketing-demo/protocol'
import { DEMO_SCENES } from '@/marketing-demo/protocol'

export type DemoComposerFile = {
  name: string
  fileType: string
  status?: 'processing' | 'completed'
  storageKey?: string
}

export type DemoImageGenerationPhase = 'empty' | 'generating' | 'done'

type DemoFrame = {
  sessionTitle: string
  inputText: string
  inputFiles: DemoComposerFile[]
  messages: Message[]
  showHtmlPreview?: boolean
  htmlPreviewCode?: string
  imageGeneration?: {
    phase: DemoImageGenerationPhase
    prompt: string
    images: string[]
  }
}

const ASSISTANT_MODEL = 'Chatbox AI (Chatbox AI 3.5)'
const DEMO_TIMESTAMP = 1_720_000_000_000

function copy(lang: DemoLang, zh: string, en: string): string {
  return lang === 'zh-Hans' || lang === 'zh-Hant' ? zh : en
}

function makeFile(partial: MessageFile): MessageFile {
  return {
    tokenCalculatedAt: {},
    ...partial,
  }
}

function makeUserMessage(id: string, text: string, files?: MessageFile[]): Message {
  return {
    id,
    role: MessageRoleEnum.User,
    contentParts: text ? [{ type: 'text', text }] : [],
    files,
    timestamp: DEMO_TIMESTAMP + 1,
    tokenCalculatedAt: {},
  }
}

function makeAssistantMessage(id: string, text: string, generating: boolean): Message {
  return makeAssistant(id, text ? [{ type: 'text', text }] : [], { generating })
}

function makeAssistant(id: string, parts: MessageContentParts, extras: Partial<Message> = {}): Message {
  return {
    id,
    role: MessageRoleEnum.Assistant,
    contentParts: parts,
    model: ASSISTANT_MODEL,
    timestamp: DEMO_TIMESTAMP + 2,
    tokenCalculatedAt: {},
    isStreamingMode: true,
    ...extras,
  }
}

function typedText(full: string, elapsed: number, start: number, end: number): { text: string; generating: boolean } {
  if (elapsed < start) return { text: '', generating: false }
  if (elapsed >= end) return { text: full, generating: false }
  const progress = (elapsed - start) / (end - start)
  const count = Math.max(1, Math.floor(full.length * progress))
  return { text: full.slice(0, count), generating: true }
}

function composerText(full: string, elapsed: number, start: number, submitAt: number): string {
  if (elapsed >= submitAt) return ''
  return typedText(full, elapsed, start, submitAt).text
}

function reasoningPart(text: string, duration?: number): MessageContentParts[number] {
  return { type: 'reasoning', text, duration }
}

function textPart(text: string): MessageContentParts[number] {
  return { type: 'text', text }
}

function toolPart(
  id: string,
  toolName: string,
  state: MessageToolCallPart['state'],
  args: unknown,
  result?: unknown,
  duration?: number
): MessageToolCallPart {
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName,
    state,
    args,
    result,
    duration,
  }
}

function fileImageChat(elapsed: number, lang: DemoLang): DemoFrame {
  const title = copy(lang, '文件问答', 'File Q&A')
  const userText = copy(
    lang,
    '看一下这份发布计划和产品截图，列出还没定的事项。',
    'Read this launch plan and the screenshot. List what still needs a decision.'
  )
  const assistantFull = copy(
    lang,
    [
      '计划里还差三件要拍板的事：',
      '',
      '1. **附件索引**的验收标准',
      '2. 桌面端升级文案的最终版本',
      '3. Agent Mode 的模型兼容范围',
      '',
      '截图对应的是新的会话主界面，侧栏和输入区已经定稿。',
    ].join('\n'),
    [
      'Three launch items still need a decision:',
      '',
      '1. **Attachment indexing** acceptance criteria',
      '2. Final desktop upsell copy',
      '3. Agent Mode model compatibility',
      '',
      'The screenshot matches the new conversation layout. Sidebar and composer are already locked.',
    ].join('\n')
  )

  const pdf = makeFile({
    id: 'demo-pdf',
    name: copy(lang, 'Q3发布计划.pdf', 'Q3-Launch-Plan.pdf'),
    fileType: 'application/pdf',
    byteLength: 142_000,
    storageKey: 'demo-pdf',
  })
  const image = makeFile({
    id: 'demo-image',
    name: copy(lang, '产品截图.png', 'product-hero.png'),
    fileType: 'image/png',
    byteLength: 86_000,
    storageKey: DEMO_HERO_IMAGE_KEY,
  })

  const inputFiles: DemoComposerFile[] = []
  if (elapsed >= 500) {
    inputFiles.push({
      name: pdf.name,
      fileType: pdf.fileType,
      status: elapsed >= 1100 ? 'completed' : 'processing',
    })
  }
  if (elapsed >= 900) {
    inputFiles.push({
      name: image.name,
      fileType: image.fileType,
      storageKey: DEMO_HERO_IMAGE_KEY,
    })
  }

  const submitted = elapsed >= 2000
  const messages: Message[] = []
  if (submitted) {
    messages.push(makeUserMessage('demo-user-1', userText, [pdf, image]))
    if (elapsed >= 2400) {
      const { text, generating } = typedText(assistantFull, elapsed, 2600, 6600)
      messages.push(makeAssistantMessage('demo-assistant-1', text, generating))
    }
  }

  return {
    sessionTitle: title,
    inputText: composerText(userText, elapsed, 500, 2000),
    inputFiles: submitted ? [] : inputFiles,
    messages,
  }
}

function webSearch(elapsed: number, lang: DemoLang): DemoFrame {
  const title = copy(lang, '联网搜索', 'Live Web Search')
  const userText = copy(
    lang,
    '查询网络，看看上海到东京的最新的机票价格',
    'Search the web for the latest flight prices from Shanghai to Tokyo'
  )
  const narration = copy(
    lang,
    '我来搜索上海到东京的最新机票价格信息。',
    "I'll search for the latest Shanghai to Tokyo flight prices."
  )
  const think1 = copy(
    lang,
    'The user asks in Chinese: search the web for the latest flight prices from Shanghai to Tokyo. I should use web_search to find current fares from a few major platforms.',
    'The user wants current Shanghai → Tokyo fares. I should search the web across major travel sites and then summarize.'
  )
  const think2 = copy(
    lang,
    'I have search results. Let me summarize the latest flight prices from Shanghai to Tokyo. The results show various prices across Skyscanner, Expedia, and airline sites.',
    'I have search results. I will summarize the latest Shanghai to Tokyo fares from the major platforms.'
  )
  const answer = copy(
    lang,
    [
      '### 上海 → 东京 近期机票',
      '',
      '| 平台 | 价格 | 说明 |',
      '| --- | --- | --- |',
      '| **天巡** | 单程 ¥1,713 起 | 9 月更便宜 |',
      '| **Expedia** | 往返 ¥2,200 起 | 周末略贵 |',
      '| **春秋 / 全日空** | 直飞 ¥1,800 起 | 红眼更便宜 |',
      '',
      '想锁最低价，优先看 **9 月中旬红眼航班**。',
    ].join('\n'),
    [
      '### Shanghai → Tokyo fares',
      '',
      '| Platform | Price | Notes |',
      '| --- | --- | --- |',
      '| **Skyscanner** | One-way from ¥1,713 | September is cheaper |',
      '| **Expedia** | Round-trip from ¥2,200 | Weekends cost more |',
      '| **Spring / ANA** | Direct from ¥1,800 | Red-eyes are cheaper |',
      '',
      'For the lowest fare, look at **mid-September red-eyes**.',
    ].join('\n')
  )

  const searchResultsZh = [
    {
      title: '上海到东京机票 – Skyscanner',
      snippet: '上海到东京单程约 ¥1,713 起，往返约 ¥2,036 起。9 月更便宜。',
      link: 'https://www.skyscanner.com/shanghai-tokyo',
    },
    {
      title: '上海浦东飞东京 – Expedia',
      snippet: '往返含春秋、全日空直飞，周末略贵。',
      link: 'https://www.expedia.com/shanghai-tokyo-flights',
    },
    {
      title: '上海-东京特价机票 – 携程',
      snippet: '近期直飞单程约 ¥1,800 起，红眼航班更低。',
      link: 'https://flights.ctrip.com/shanghai-tokyo',
    },
  ]
  const searchResultsEn = [
    {
      title: 'Shanghai to Tokyo flights – Skyscanner',
      snippet: 'One-way from ¥1,713 and round-trip from ¥2,036. September is cheaper.',
      link: 'https://www.skyscanner.com/shanghai-tokyo',
    },
    {
      title: 'SHA to TYO flights – Expedia',
      snippet: 'Round-trip fares from Shanghai Pudong to Tokyo Haneda/Narita.',
      link: 'https://www.expedia.com/shanghai-tokyo-flights',
    },
    {
      title: 'Shanghai–Tokyo deals – Trip.com',
      snippet: 'Direct one-way from about ¥1,800. Red-eyes are cheaper.',
      link: 'https://flights.ctrip.com/shanghai-tokyo',
    },
  ]
  const results = lang === 'en' ? searchResultsEn : searchResultsZh

  const messages: Message[] = []
  if (elapsed >= 1100) messages.push(makeUserMessage('demo-user-web', userText))
  if (elapsed >= 1500) {
    const parts: MessageContentParts = []
    parts.push(reasoningPart(think1, elapsed >= 2200 ? 700 : undefined))
    if (elapsed >= 2200) parts.push(textPart(narration))
    if (elapsed >= 2400) {
      parts.push(
        toolPart(
          'demo-web-search-1',
          'web_search',
          elapsed >= 3100 ? 'result' : 'call',
          { query: copy(lang, '上海到东京 机票价格 最新', 'Shanghai to Tokyo flight tickets price latest') },
          elapsed >= 3100 ? { query: '上海到东京 机票价格 最新', searchResults: results } : undefined,
          elapsed >= 3100 ? 700 : undefined
        )
      )
    }
    if (elapsed >= 3300) {
      parts.push(
        toolPart(
          'demo-web-search-2',
          'web_search',
          elapsed >= 4000 ? 'result' : 'call',
          { query: 'Shanghai to Tokyo flight tickets price cheapest' },
          elapsed >= 4000
            ? { query: 'Shanghai to Tokyo flight tickets price cheapest', searchResults: results }
            : undefined,
          elapsed >= 4000 ? 700 : undefined
        )
      )
    }
    if (elapsed >= 4200) parts.push(reasoningPart(think2, elapsed >= 4800 ? 600 : undefined))
    const generating = elapsed < 7400
    if (elapsed >= 5000) {
      const { text } = typedText(answer, elapsed, 5000, 7200)
      if (text) parts.push(textPart(text))
    }
    messages.push(
      makeAssistant('demo-assistant-web', parts, {
        generating,
        tokensUsed: generating ? undefined : 1820,
      })
    )
  }

  return {
    sessionTitle: title,
    inputText: composerText(userText, elapsed, 400, 1100),
    inputFiles: [],
    messages,
  }
}

function knowledgeBase(elapsed: number, lang: DemoLang): DemoFrame {
  const title = copy(lang, '知识库', 'Knowledge Base')
  const userText = copy(lang, '主角的名字', "What's the protagonist's name?")
  const think1 = copy(
    lang,
    'The user is asking "主角的名字" (the name of the protagonist/main character). This is a very vague question. It is related to the knowledge base documents.',
    "The user asked for the protagonist's name. That is vague, so I should query the knowledge base first."
  )
  const think2 = copy(
    lang,
    'The user asks "主角的名字" (the name of the protagonist). The knowledge base contains three files:',
    'The knowledge base has three files. I should list them and then read the relevant chunks.'
  )
  const think3 = copy(
    lang,
    'The user asked "主角的名字". Given the knowledge base documents, there are three files. The fiction excerpt is the one that names a protagonist.',
    'Given the knowledge-base documents, the fiction excerpt is the one that names a protagonist.'
  )
  const answer = copy(
    lang,
    [
      '你问的应该是知识库里的《切片》，主角是 **齐夏**。',
      '',
      '原文：「一位名叫**齐夏**的年轻人坐在距离山羊头最远的地方，他迅速打量了一下屋内的情况」——后文一直跟着他的观察和推理走。',
    ].join('\n'),
    [
      'You probably mean the knowledge-base excerpt *Slice*. The protagonist is **Qi Xia**.',
      '',
      'The text follows him from the start: “A young man named **Qi Xia** sat farthest from the goat head and quickly scanned the room.”',
    ].join('\n')
  )

  const messages: Message[] = []
  if (elapsed >= 800) messages.push(makeUserMessage('demo-user-kb', userText))
  if (elapsed >= 1200) {
    const parts: MessageContentParts = []
    parts.push(reasoningPart(think1, elapsed >= 1800 ? 600 : undefined))
    if (elapsed >= 2000) {
      parts.push(
        toolPart(
          'demo-kb-query',
          'query_knowledge_base',
          elapsed >= 2700 ? 'result' : 'call',
          { query: copy(lang, '主角的名字 主要人物 主人公', 'protagonist name main character') },
          elapsed >= 2700 ? { summary: copy(lang, '命中 3 个文档', 'Matched 3 documents') } : undefined,
          elapsed >= 2700 ? 700 : undefined
        )
      )
    }
    if (elapsed >= 2900) {
      parts.push(
        toolPart(
          'demo-kb-list',
          'list_files',
          elapsed >= 3500 ? 'result' : 'call',
          {},
          elapsed >= 3500 ? { summary: 'Completed' } : undefined,
          elapsed >= 3500 ? 600 : undefined
        )
      )
    }
    if (elapsed >= 3700) parts.push(reasoningPart(think2, elapsed >= 4300 ? 600 : undefined))
    if (elapsed >= 4500) {
      parts.push(
        toolPart(
          'demo-kb-read',
          'read_file_chunks',
          elapsed >= 5200 ? 'result' : 'call',
          { query: copy(lang, '齐夏 主角', 'Qi Xia protagonist') },
          elapsed >= 5200 ? { summary: 'Completed' } : undefined,
          elapsed >= 5200 ? 700 : undefined
        )
      )
    }
    if (elapsed >= 5400) parts.push(reasoningPart(think3, elapsed >= 6000 ? 600 : undefined))
    const generating = elapsed < 8400
    if (elapsed >= 6200) {
      const { text } = typedText(answer, elapsed, 6200, 8200)
      if (text) parts.push(textPart(text))
    }
    messages.push(
      makeAssistant('demo-assistant-kb', parts, {
        generating,
        tokensUsed: generating ? undefined : 4295,
      })
    )
  }

  return {
    sessionTitle: title,
    inputText: composerText(userText, elapsed, 300, 800),
    inputFiles: [],
    messages,
  }
}

function richFormatting(elapsed: number, lang: DemoLang): DemoFrame {
  const title = copy(lang, '公式排版', 'Rich Formatting')
  const userText = copy(
    lang,
    '280 万房贷，3.1% 等额本息 30 年，月供大概多少',
    "What's the monthly payment on a $380k mortgage at 6.2% for 30 years?"
  )
  const answer = copy(
    lang,
    [
      '等额本息可以按这一式算：',
      '',
      '$$M = P \\cdot \\frac{r(1+r)^{n}}{(1+r)^{n}-1}$$',
      '',
      '月利率 $r = 3.1\\%/12$，期数 $n = 360$。代进去大约 **¥11,960 / 月**。',
    ].join('\n'),
    [
      'For equal monthly payments:',
      '',
      '$$M = P \\cdot \\frac{r(1+r)^{n}}{(1+r)^{n}-1}$$',
      '',
      'Monthly rate $r = 6.2\\%/12$, $n = 360$ payments. That comes to about **$2,330 / month**.',
    ].join('\n')
  )

  const messages: Message[] = []
  if (elapsed >= 1300) messages.push(makeUserMessage('demo-user-math', userText))
  if (elapsed >= 1800) {
    const { text, generating } = typedText(answer, elapsed, 2000, 4600)
    messages.push(makeAssistantMessage('demo-assistant-math', text, generating))
  }

  return {
    sessionTitle: title,
    inputText: composerText(userText, elapsed, 400, 1300),
    inputFiles: [],
    messages,
  }
}

function inviteHtml(lang: DemoLang): string {
  const isZh = lang !== 'en'
  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${isZh ? '周六早午餐' : 'Saturday Brunch'}</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      display: flex; align-items: center; justify-content: center;
      font-family: "Palatino Linotype", "Songti SC", serif;
      background: #f3eee6; color: #2b2418;
    }
    .card {
      text-align: center; padding: 52px 44px;
      background: #fffaf2; border: 1px solid #e2d6c6;
    }
    .kicker { font-size: 11px; letter-spacing: .32em; text-transform: uppercase; color: #8d7d66; }
    h1 { font-size: 34px; font-weight: 500; margin: 14px 0 10px; }
    p { margin: 0; font-size: 15px; line-height: 1.7; color: #5f5346; }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">${isZh ? '邀请你来' : "You're invited"}</div>
    <h1>${isZh ? '周六早午餐' : 'Saturday Brunch'}</h1>
    <p>${isZh ? '本周六 11:00<br>梧桐路 18 号 · 花园' : 'This Saturday, 11:00<br>18 Willow Street · Garden'}</p>
  </div>
</body>
</html>`
}

function codePreview(elapsed: number, lang: DemoLang): DemoFrame {
  const title = copy(lang, '代码预览', 'Code & Preview')
  const userText = copy(
    lang,
    '帮我做一个周六 brunch 的邀请函小页面，简约一点，写上时间和地点就行',
    'Make a small Saturday brunch invite page — just time and place, keep it simple'
  )
  const think = copy(
    lang,
    'A simple brunch invite. Centered cream card with time and place is enough — no tools needed.',
    'A simple brunch invite. Centered cream card with time and place is enough — no tools needed.'
  )
  const html = inviteHtml(lang)
  const prefix = copy(lang, '做了一张很干净的邀请函：\n\n', 'Here is a quiet little invite card:\n\n')
  const answerFull = `${prefix}\`\`\`html\n${html}\n\`\`\``

  const messages: Message[] = []
  if (elapsed >= 1400) messages.push(makeUserMessage('demo-user-code', userText))
  if (elapsed >= 1900) {
    const parts: MessageContentParts = [reasoningPart(think, elapsed >= 2600 ? 700 : undefined)]
    const generating = elapsed < 6700
    if (elapsed >= 2700) {
      const { text } = typedText(answerFull, elapsed, 2700, 6500)
      if (text) parts.push(textPart(text))
    }
    messages.push(
      makeAssistant('demo-assistant-code', parts, {
        generating,
        tokensUsed: generating ? undefined : 2103,
      })
    )
  }

  return {
    sessionTitle: title,
    inputText: composerText(userText, elapsed, 400, 1400),
    inputFiles: [],
    messages,
    showHtmlPreview: elapsed >= 6800,
    htmlPreviewCode: html,
  }
}

function imageGeneration(elapsed: number, lang: DemoLang): DemoFrame {
  const title = copy(lang, '图片生成', 'Image Generation')
  const prompt = copy(
    lang,
    '画一只趴在窗台上看书的橘猫，窗外是下午的阳光和绿植。',
    'A ginger cat reading on a windowsill, afternoon sun and plants outside.'
  )
  const phase: DemoImageGenerationPhase = elapsed < 2600 ? 'empty' : elapsed < 7200 ? 'generating' : 'done'
  return {
    sessionTitle: title,
    inputText: phase === 'empty' ? composerText(prompt, elapsed, 500, 2600) : '',
    inputFiles: [],
    messages: [],
    imageGeneration: {
      phase,
      prompt,
      images: phase === 'done' ? [DEMO_GEN_IMAGE_1_KEY] : [],
    },
  }
}

export function getSceneFrame(scene: DemoSceneId, elapsed: number, lang: DemoLang): DemoFrame {
  switch (scene) {
    case 'file-image-chat':
      return fileImageChat(elapsed, lang)
    case 'web-search':
      return webSearch(elapsed, lang)
    case 'knowledge-base':
      return knowledgeBase(elapsed, lang)
    case 'rich-formatting':
      return richFormatting(elapsed, lang)
    case 'code-preview':
      return codePreview(elapsed, lang)
    case 'image-generation':
      return imageGeneration(elapsed, lang)
  }
}

export function getSidebarSessions(lang: DemoLang): Array<{ id: DemoSceneId; label: string }> {
  return [
    { id: 'file-image-chat', label: copy(lang, '文件问答', 'File Q&A') },
    { id: 'web-search', label: copy(lang, '联网搜索', 'Live Web Search') },
    { id: 'knowledge-base', label: copy(lang, '知识库', 'Knowledge Base') },
    { id: 'rich-formatting', label: copy(lang, '公式排版', 'Rich Formatting') },
    { id: 'code-preview', label: copy(lang, '代码预览', 'Code & Preview') },
    { id: 'image-generation', label: copy(lang, '图片生成', 'Image Generation') },
  ]
}

export function getChatScenes(): DemoSceneId[] {
  return DEMO_SCENES.filter((scene) => scene !== 'image-generation')
}
