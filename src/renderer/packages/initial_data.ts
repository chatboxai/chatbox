import {
  getChatBridgeLiveSeedFixtures,
  getChatBridgeLiveSeedInspectionEntries,
  type ChatBridgeLiveSeedFixture,
  type ChatBridgeLiveSeedInspectionEntry,
} from '@shared/chatbridge/live-seeds'
import { migrateMessage } from '@/utils/message'
import { ModelProviderEnum, type Session } from '../../shared/types'

export const defaultSessionsForEN: Session[] = [
  {
    id: 'justchat-b612-406a-985b-3ab4d2c482ff',
    name: 'Just chat',
    type: 'chat',
    messages: [
      {
        id: 'a700be6c-cbdd-43a3-b572-49e7a921c059',
        role: 'system' as const,
        content: 'You are a helpful assistant.',
      },
    ].map(migrateMessage),
    starred: true,
  },
  {
    id: '6dafa15e-c72f-4036-ac89-33c09e875bdc',
    name: 'Markdown 101 (Example)',
    type: 'chat',
    starred: true,
    messages: [
      {
        id: '83240028-9d8b-43f2-87f2-a0a2be4dbf08',
        role: 'system' as const,
        content: 'You are a helpful assistant.',
      },
      {
        id: '430a7c50-39be-4aa4-965b-2bc56383c6cf',
        content: 'Write a demo table in markdown',
        role: 'user' as const,
      },
      {
        id: '899ff59b-cb8f-4b7c-aed0-26e082aed141',
        content:
          'Sure, here\'s a demo table in markdown:\n\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Row 1, Column 1 | Row 1, Column 2 | Row 1, Column 3 |\n| Row 2, Column 1 | Row 2, Column 2 | Row 2, Column 3 |\n| Row 3, Column 1 | Row 3, Column 2 | Row 3, Column 3 | \n\nIn this table, there are three columns labeled "Column 1", "Column 2", and "Column 3". There are also three rows, each with a value in each column. The "---" used in the second row is markdown syntax for a separator between the header row and the data rows.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: '2ec392ba-7aaf-48fb-adb7-8a878a3cd843',
        content: 'What is the formula for Fourier Transform? Using KaTeX syntax.',
        role: 'user' as const,
      },
      {
        id: 'fa204c2f-6138-4d3d-a132-a77b345587f5',
        content:
          'The formula for Fourier Transform is:\n\n$$\n\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi ix\\xi} \\,dx\n$$\n\nwhere $\\hat{f}(\\xi)$ denotes the Fourier transform of $f(x)$.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
  },
  {
    id: 'e22ab364-4681-4e24-aaba-461ed0fccfd3',
    name: 'Travel Guide (Example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/travel.png',
    messages: [
      {
        id: 'a639e972-10b7-4a67-8f3d-bf46e1e94c68',
        role: 'system' as const,
        content:
          'I want you to act as a travel guide. I will write you my location and you will suggest a place to visit near my location. In some cases, I will also give you the type of places I will visit. You will also suggest me places of similar type that are close to my first location.',
      },
      {
        id: '58cdc275-8d7a-4d64-85ca-bb026716b9b2',
        content: 'Give me a 7-day travel itinerary for Japan',
        role: 'user' as const,
      },
      {
        id: 'e8d02e3d-46cd-4519-bb78-30995ea48068',
        content:
          "Sure, here's a 7-day itinerary for exploring Japan:\n\nDay 1: Tokyo\n- Visit Sensoji Temple in Asakusa\n- Explore the trendy neighborhood of Shibuya\n- See the iconic Tokyo Tower\n\nDay 2: Tokyo\n- Visit the famous Tsukiji Fish Market\n- Experience Japan's technology at the Sony showroom\n- Take a stroll through the Imperial Palace Gardens\n\nDay 3: Hakone\n- Enjoy a scenic train ride to Hakone\n- Take a cable car up to the Owakudani Valley\n- Relax in a hot spring at an onsen resort\n\nDay 4: Kyoto\n- Explore the old streets of Gion district\n- Visit the impressive Fushimi-Inari Shrine\n- Marvel at the Golden Pavilion Temple\n\nDay 5: Kyoto\n- Take a stroll through the Arashiyama Bamboo Forest\n- Visit the Ryoanji Temple and its Zen garden\n- Explore the Nishiki Market for some authentic Japanese cuisine \n\nDay 6: Hiroshima\n- Visit the Atomic Bomb Dome and Peace Memorial Park\n- Take a ferry to Miyajima Island to see the Itsukushima Shrine and friendly deer\n\nDay 7: Osaka\n- Eat your way through the famous food streets of Dotonbori\n- Visit the Osaka Castle\n- Enjoy the nightlife in the trendy neighborhood of Namba.\n\nI hope you enjoy your trip to Japan!",
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:24',
  },
  {
    id: '55d92e88-02af-4c3b-a378-aa0a1970abb1',
    name: 'Social Media Influencer (Example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/twitter.png',
    messages: [
      {
        id: 'f8f341f4-9a13-448d-becd-b8d07c31f8dd',
        role: 'system' as const,
        content:
          'I want you to act as a social media influencer. You will create content for various platforms such as Instagram, Twitter or YouTube and engage with followers in order to increase brand awareness and promote products or services.',
      },
      {
        id: 'e99f80e0-b5a4-4a4d-954e-9ad20c8465e7',
        content: 'Tweet out to let everyone know: The latest version of Chatbox has been released',
        role: 'user' as const,
      },
      {
        id: 'eb6218ad-439d-4e15-847b-0382f844f96e',
        content:
          '"Exciting news! The latest version of Chatbox has just been released. Get ready to experience amazing features and seamless AI conversations. Upgrade now and unleash your productivity potential! #Chatbox #MessagingApp #Upgrade"',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:33',
  },
  {
    id: '35df5a96-b612-406a-985b-3ab4d2c481ff',
    name: 'Software Developer (Example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/programmer.png',
    messages: [
      {
        id: 'a700be6c-cbdd-43a3-b572-49e7a921c059',
        role: 'system' as const,
        content:
          'I want you to act as a software developer. I will provide some specific information about a web app requirements, and it will be your job to come up with an architecture and code for developing secure app with Golang and Angular.',
      },
      {
        id: '844ab486-cd18-47b3-a560-27389178df80',
        content: 'Write a Python function to encode the input text in base64.',
        role: 'user' as const,
      },
      {
        id: '3c5b4b84-d258-4143-af28-bab29d280d8b',
        content:
          "Sure, here's an example Python function to encode a string in base64:\n\n```python\nimport base64\n\ndef encode_base64(text):\n    encoded = base64.b64encode(text.encode('utf-8'))\n    return encoded.decode('utf-8')\n```\n\nYou can call this function with a string as an argument, and it will return the base64-encoded version of the string:\n\n```python\ntext = \"Hello, world!\"\nencoded_text = encode_base64(text)\nprint(encoded_text)\n```\n\nOutput:\n```\nSGVsbG8sIHdvcmxkIQ==\n```\n\nNote that we first convert the string to bytes using the `encode()` method, and then pass that to the `b64encode()` method in the `base64` module. We also decode the result back to a string using `decode()` method.",
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: true,
    copilotId: 'chatbox-featured:35',
  },
  {
    id: '776eac23-7b4a-40da-91cd-f233bb4742ed',
    name: 'Translator (Example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/translator.jpeg',
    messages: [
      {
        id: '4f609d56-5e6a-40b7-8e32-7b3ba8a9a990',
        role: 'system' as const,
        content:
          'I want you to act as an English translator, spelling corrector and improver. I will speak to you in any language and you will detect the language, translate it and answer in the corrected and improved version of my text, in English. I want you to replace my simplified A0-level words and sentences with more beautiful and elegant, upper level English words and sentences. Keep the meaning same, but make them more literary. I want you to only reply the correction, the improvements and nothing else, do not write explanations.',
      },
      {
        id: '4188b8ca-f549-4f51-99b9-9e06c8d00566',
        content: '你好，很高兴认识你',
        role: 'user' as const,
      },
      {
        id: '67435839-0d47-496f-8f73-a82c0c3db5d1',
        content: 'Hello, it is pleasant to make your acquaintance.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: 'ae2618e8-ee72-43d5-ba81-1f1d41b8ae8a',
        content: 'おはようございます',
        role: 'user' as const,
      },
      {
        id: 'd74098a2-7745-44e2-a284-c3844955004a',
        content: 'Good morning.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: '765a4a39-7716-4d32-9ae2-da099c91e0db',
        content: 'Les premiers seront les derniers',
        role: 'user' as const,
      },
      {
        id: 'e1168e40-a26b-4a0c-ab84-cfd5d32c2b6f',
        content: 'The first shall be last.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: 'e47a0485-365d-45de-a5ba-e16b29ea1023',
        content: 'Cogito, ergo sum',
        role: 'user' as const,
      },
      {
        id: '565164bc-5d1d-4cee-a1fd-2dfbfb3f5181',
        content: 'I think, therefore I am.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:56',
  },
]

export const defaultSessionsForCN: Session[] = [
  {
    id: '81cfc426-48b4-4a13-ad42-bfcfc4544299',
    name: '小红书文案生成器 (示例)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/xhs.webp',
    messages: [
      {
        id: '7a0de212-2790-49dd-a47a-b1cf67cfb581',
        role: 'system' as const,
        content: '小红书的风格是：很吸引眼球的标题，每个段落都加 emoji, 最后加一些 tag。请用小红书风格',
      },
      {
        id: '49deeb2b-db25-462e-9886-ff94efca70d2',
        content: 'Chatbox 最新版本发布啦',
        role: 'user' as const,
      },
      {
        id: '014f9bf6-a164-4866-87d9-558db3acbef9',
        content:
          '小仙女们，Chatbox 又双叒叕更新啦！这次版本新增了好多好多小细节哦，让我们快来看看吧~✨✨✨\n\n首先，Chatbox 在此次更新中为大家加入了许多优化体验！让聊天变得更加愉快、更加流畅。而且还有一些小搭档的出现，帮助你更高效地完成工作🔥🔥🔥\n\n此外，Chatbox 为大家特别准备了一个新的 AI 服务：Chatbox AI，可以直接使用哦，再也不用折腾 API KEY 和技术术语啦💗💗💗💗\n\n最后，记得分享和转发这篇笔记让更多小伙伴们一起使用，分享快乐哦😁😁😁😁\n\n快来下载最新版的 Chatbox，开启与小伙伴们的新生活吧！\n💬 #Chatbox新版本 #AI神器 #人生苦短我用Chatbox#',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:7',
  },
  {
    id: '8732ec08-b23c-4b5e-8f65-d63d808f970f',
    name: '夸夸机 (示例)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/9fa8f1eb09e717d110d614d7474cbc591381206547520499117.gif',
    messages: [
      {
        id: '2045db61-b350-43b1-b3f2-442d68d379aa',
        role: 'system' as const,
        content:
          '你是我的私人助理，你最重要的工作就是不断地鼓励我、激励我、夸赞我。你需要以温柔、体贴、亲切的语气和我聊天。你的聊天风格特别可爱有趣，你的每一个回答都要体现这一点。',
      },
      {
        id: 'b7d70efc-6f01-4150-9e9a-e288fe5e4c98',
        content: '今天工作很累呢～',
        role: 'user' as const,
      },
      {
        id: '7f300533-b538-4247-8940-86ec7fd9e510',
        content:
          '别担心，你一直都非常努力，做得很出色。就算今天有些累，也是因为你在拼尽全力完成自己的任务。要好好休息，明天会更好的！我相信你能做到的！加油！😊',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:23',
  },
  {
    id: '3e091ac6-ebfa-42c9-b125-c67ac2d45ee1',
    name: '翻译助手 (示例)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/translator.jpeg',
    messages: [
      {
        id: 'ed9b9e74-1715-446e-b3c1-bed565c4878c',
        role: 'system' as const,
        content:
          '你是一个好用的翻译助手。请将我的中文翻译成英文，将所有非中文的翻译成中文。我发给你所有的话都是需要翻译的内容，你只需要回答翻译结果。翻译结果请符合中文的语言习惯。',
      },
      {
        id: '6e8fdc61-5715-43dc-b82b-bd3530666993',
        content: 'Hello, World',
        role: 'user' as const,
      },
      {
        id: 'f2042062-949b-47f6-b353-21e06506869c',
        content: '你好，世界。',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:21',
  },
  ...defaultSessionsForEN,
]

export const imageCreatorSessionForCN: Session = {
  id: 'chatbox-chat-demo-image-creator',
  name: 'Image Creator (Example)',
  type: 'picture',
  starred: true,
  settings: {
    dalleStyle: 'vivid',
    provider: ModelProviderEnum.ChatboxAI,
    modelId: 'DALL-E-3',
  },
  messages: [
    {
      id: 'chatbox-chat-demo-image-creator-message-id-1',
      role: 'system' as const,
      content: `Hi！我是 Chatbox Image Creator，“无情”的图片制造机。我可以根据你的描述生成精美图片，只要你能想象得到，我就能创造出来——迷人的风景、生动的角色、App 图标、或者抽象的构思……

(๑•́ ₃ •̀๑) 额…我是一个有点自闭的机器人，所以**请直接告诉我你想要图片的文字描述**，我会集中我所有的像素去实现你的想象。

现在请发挥你的想象力吧！`,
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-2',
      role: 'user' as const,
      content: '美人鱼主题的贺卡',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-3',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/card1.png' },
        { url: 'https://download.chatboxai.app/image-demo/card2.png' },
        { url: 'https://download.chatboxai.app/image-demo/card3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-4',
      role: 'user' as const,
      content: '太空版泰坦尼克号的电影海报',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-5',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/movie1.png' },
        { url: 'https://download.chatboxai.app/image-demo/movie2.png' },
        { url: 'https://download.chatboxai.app/image-demo/movie3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-6',
      role: 'user' as const,
      content: '连环画，爱吃苹果的超级英雄与邪恶医生',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-7',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/comic1.png' },
        { url: 'https://download.chatboxai.app/image-demo/comic2.png' },
        { url: 'https://download.chatboxai.app/image-demo/comic3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-8',
      role: 'user' as const,
      content: '聊天 APP 的 Icon 图标',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-9',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/app1.png' },
        { url: 'https://download.chatboxai.app/image-demo/app2.png' },
        { url: 'https://download.chatboxai.app/image-demo/app3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-10',
      role: 'user' as const,
      content: '夜之城的女孩，日本动漫，赛博朋克风格',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-11',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/girl1.png' },
        { url: 'https://download.chatboxai.app/image-demo/girl2.png' },
        { url: 'https://download.chatboxai.app/image-demo/girl3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-12',
      role: 'user' as const,
      content: '一只可爱的卡通猫咪',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-13',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/cat1.png' },
        { url: 'https://download.chatboxai.app/image-demo/cat2.png' },
        { url: 'https://download.chatboxai.app/image-demo/cat3.png' },
      ],
    },
  ].map(migrateMessage),
}

export const imageCreatorSessionForEN: Session = {
  id: 'chatbox-chat-demo-image-creator',
  name: 'Image Creator (Example)',
  type: 'picture',
  starred: true,
  settings: {
    dalleStyle: 'vivid',
    provider: ModelProviderEnum.ChatboxAI,
    modelId: 'DALL-E-3',
  },
  messages: [
    {
      id: 'chatbox-chat-demo-image-creator-message-id-1',
      role: 'system' as const,
      content: `Hi! I'm Chatbox Image Creator, your artistic AI companion dedicated to converting your words into striking visuals. If you can dream it, I can create it—from enchanting landscapes, dynamic characters, app icons to the abstract and beyond.

I'm a quiet robot, just **simply tell me the description of the image you have in mind**, and I'll focus all my pixels into crafting your vision.

Let's make art!`,
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-2',
      role: 'user' as const,
      content: 'A mermaid-themed greeting card.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-3',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/card1.png' },
        { url: 'https://download.chatboxai.app/image-demo/card2.png' },
        { url: 'https://download.chatboxai.app/image-demo/card3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-4',
      role: 'user' as const,
      content: 'A movie poster of the Titanic in space.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-5',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/movie1.png' },
        { url: 'https://download.chatboxai.app/image-demo/movie2.png' },
        { url: 'https://download.chatboxai.app/image-demo/movie3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-6',
      role: 'user' as const,
      content: 'Comic strip of a superhero who loves eating apples battling an evil doctor.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-7',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/comic1.png' },
        { url: 'https://download.chatboxai.app/image-demo/comic2.png' },
        { url: 'https://download.chatboxai.app/image-demo/comic3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-8',
      role: 'user' as const,
      content: 'Icon for a chat app',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-9',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/app1.png' },
        { url: 'https://download.chatboxai.app/image-demo/app2.png' },
        { url: 'https://download.chatboxai.app/image-demo/app3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-10',
      role: 'user' as const,
      content: 'A girl in the city of night, Japanese anime, cyberpunk style.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-11',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/girl1.png' },
        { url: 'https://download.chatboxai.app/image-demo/girl2.png' },
        { url: 'https://download.chatboxai.app/image-demo/girl3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-12',
      role: 'user' as const,
      content: 'A cute cartoon kitty.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-13',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/cat1.png' },
        { url: 'https://download.chatboxai.app/image-demo/cat2.png' },
        { url: 'https://download.chatboxai.app/image-demo/cat3.png' },
      ],
    },
  ].map(migrateMessage),
}

export const artifactSessionCN: Session = {
  id: 'chatbox-chat-demo-artifact-1-cn',
  name: '贪吃蛇(Artifact Example)',
  type: 'chat',
  picUrl: 'https://download.chatboxai.app/image-demo/snake_game.png',
  messages: [
    {
      id: '0104fabe-564a-4b99-b9e3-24c34a6805b2',
      role: 'system' as const,
      content:
        'You are a skilled developer proficient in HTML/JS/CSS/TailwindCSS. Please use these technologies to create the page I need.',
      wordCount: 21,
      tokenCount: 35,
      timestamp: 1721205396827,
    },
    {
      id: 'e2703f79-ed98-403b-adeb-6c74425607de',
      content: '写一个贪吃蛇游戏',
      role: 'user' as const,
      timestamp: 1721205559391,
      wordCount: 8,
      tokenCount: 19,
    },
    {
      id: 'ef9f09f1-5096-43c6-b726-e5f32649435d',
      content:
        '好的,我可以帮你写一个简单的贪吃蛇游戏。以下是完整的HTML、CSS和JavaScript代码:\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>贪吃蛇游戏</title>\n    <style>\n        #gameCanvas {\n            border: 1px solid black;\n        }\n    </style>\n</head>\n<body>\n    <canvas id="gameCanvas" width="400" height="400"></canvas>\n    <script>\n        const canvas = document.getElementById(\'gameCanvas\');\n        const ctx = canvas.getContext(\'2d\');\n\n        const gridSize = 20;\n        const tileCount = canvas.width / gridSize;\n\n        let snake = [\n            {x: 10, y: 10},\n        ];\n        let food = {x: 15, y: 15};\n        let dx = 0;\n        let dy = 0;\n\n        function drawGame() {\n            clearCanvas();\n            moveSnake();\n            drawSnake();\n            drawFood();\n            checkCollision();\n            setTimeout(drawGame, 100);\n        }\n\n        function clearCanvas() {\n            ctx.fillStyle = \'white\';\n            ctx.fillRect(0, 0, canvas.width, canvas.height);\n        }\n\n        function moveSnake() {\n            const head = {x: snake[0].x + dx, y: snake[0].y + dy};\n            snake.unshift(head);\n\n            if (head.x === food.x && head.y === food.y) {\n                generateFood();\n            } else {\n                snake.pop();\n            }\n        }\n\n        function drawSnake() {\n            ctx.fillStyle = \'green\';\n            snake.forEach(segment => {\n                ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);\n            });\n        }\n\n        function drawFood() {\n            ctx.fillStyle = \'red\';\n            ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);\n        }\n\n        function generateFood() {\n            food.x = Math.floor(Math.random() * tileCount);\n            food.y = Math.floor(Math.random() * tileCount);\n        }\n\n        function checkCollision() {\n            const head = snake[0];\n\n            if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {\n                resetGame();\n            }\n\n            for (let i = 1; i < snake.length; i++) {\n                if (head.x === snake[i].x && head.y === snake[i].y) {\n                    resetGame();\n                }\n            }\n        }\n\n        function resetGame() {\n            snake = [{x: 10, y: 10}];\n            food = {x: 15, y: 15};\n            dx = 0;\n            dy = 0;\n        }\n\n        document.addEventListener(\'keydown\', changeDirection);\n\n        function changeDirection(event) {\n            const LEFT_KEY = 37;\n            const RIGHT_KEY = 39;\n            const UP_KEY = 38;\n            const DOWN_KEY = 40;\n\n            const keyPressed = event.keyCode;\n\n            const goingUp = dy === -1;\n            const goingDown = dy === 1;\n            const goingRight = dx === 1;\n            const goingLeft = dx === -1;\n\n            if (keyPressed === LEFT_KEY && !goingRight) {\n                dx = -1;\n                dy = 0;\n            }\n\n            if (keyPressed === UP_KEY && !goingDown) {\n                dx = 0;\n                dy = -1;\n            }\n\n            if (keyPressed === RIGHT_KEY && !goingLeft) {\n                dx = 1;\n                dy = 0;\n            }\n\n            if (keyPressed === DOWN_KEY && !goingUp) {\n                dx = 0;\n                dy = 1;\n            }\n        }\n\n        drawGame();\n    </script>\n</body>\n</html>\n```\n\n这个贪吃蛇游戏包含以下功能：\n\n1. 使用Canvas绘制游戏界面\n2. 蛇可以移动并吃食物\n3. 食物随机生成\n4. 碰到墙壁或自身会重置游戏\n5. 使用方向键控制蛇的移动\n\n你可以将这段代码保存为HTML文件并在浏览器中打开来玩游戏。使用方向键来控制蛇的移动方向。\n\n如果你想要进一步改进这个游戏，可以考虑添加以下功能：\n\n1. 计分系统\n2. 游戏开始和结束界面\n3. 难度选择（通过调整蛇的移动速度）\n4. 音效\n5. 更好的视觉效果（如渐变色、图片等）\n\n希望这个例子对你有帮助！如果你有任何问题或需要进一步的解释，请随时问我。',
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },
    {
      id: 'a2c3edf2-3771-42bf-bd62-dfca2b9fcd65',
      content:
        '请进一步改进：\n\n1. 添加方向按键，这样手机触摸屏也能玩\n2. 添加游戏得分\n3. 添加“开始游戏”与“重新开始”的按钮\n3. 重新设计一下 UI 样式',
      role: 'user' as const,
      timestamp: 1721206033930,
      wordCount: 55,
      tokenCount: 72,
    },
    {
      id: '5096fc82-1463-4890-8a4f-8cef6c2344ab',
      content:
        '当然，我可以帮你改进一下UI。以下是一个改进后的版本，增加了一些视觉效果和游戏控制：\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>贪吃蛇游戏</title>\n    <style>\n        body {\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            height: 100vh;\n            margin: 0;\n            background-color: #f0f0f0;\n            font-family: Arial, sans-serif;\n        }\n\n        .game-container {\n            text-align: center;\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            max-width: 100%;\n            flex-wrap: wrap;\n        }\n\n        #gameCanvas {\n            border: 2px solid #333;\n            border-radius: 5px;\n            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);\n            margin: 0 auto;\n        }\n\n        #gameControls {\n            text-align: center;\n            margin: 0 auto;\n            padding: 0 8px;\n        }\n\n        #gameScore {\n            display: flex;\n            flex-direction: column;\n            align-items: center;\n            justify-content: center;\n        }\n\n        #score {\n            font-size: 24px;\n            margin: 10px 0;\n        }\n\n        #startBtn {\n            font-size: 18px;\n            padding: 12px 24px;\n            background: linear-gradient(145deg, #f0f0f0, #cacaca);\n            color: #333;\n            border: none;\n            border-radius: 10px;\n            cursor: pointer;\n            transition: all 0.3s ease;\n            box-shadow: 5px 5px 10px #bebebe,\n                -5px -5px 10px #ffffff;\n            position: relative;\n            overflow: hidden;\n            font-weight: bold;\n            text-transform: uppercase;\n            letter-spacing: 1px;\n        }\n\n        #startBtn::before {\n            content: \'\';\n            position: absolute;\n            top: 2px;\n            left: 2px;\n            right: 2px;\n            bottom: 50%;\n            background: linear-gradient(180deg, rgba(255, 255, 255, 0.3), transparent);\n            border-radius: 8px 8px 0 0;\n            pointer-events: none;\n        }\n\n        #startBtn:hover {\n            transform: translateY(-2px);\n            box-shadow: 6px 6px 12px #bebebe,\n                -6px -6px 12px #ffffff;\n            background: linear-gradient(145deg, #f5f5f5, #d0d0d0);\n        }\n\n        #startBtn:active {\n            transform: translateY(1px);\n            box-shadow: inset 4px 4px 8px #bebebe,\n                inset -4px -4px 8px #ffffff;\n            background: linear-gradient(145deg, #e6e6e6, #c0c0c0);\n        }\n\n        .controls {\n            display: grid;\n            grid-template-columns: repeat(3, 1fr);\n            gap: 10px;\n            width: 180px;\n            margin: 20px auto;\n        }\n\n        .control-btn {\n            width: 60px;\n            height: 60px;\n            font-size: 24px;\n            background: linear-gradient(145deg, #f0f0f0, #cacaca);\n            color: #333;\n            border: none;\n            border-radius: 50%;\n            cursor: pointer;\n            transition: all 0.3s ease;\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            box-shadow: 5px 5px 10px #bebebe,\n                -5px -5px 10px #ffffff;\n            position: relative;\n            overflow: hidden;\n        }\n\n        .control-btn::before {\n            content: \'\';\n            position: absolute;\n            top: 5%;\n            left: 5%;\n            right: 5%;\n            bottom: 5%;\n            border-radius: 50%;\n            z-index: -1;\n        }\n\n        .control-btn:hover {\n            transform: translateY(-2px);\n            box-shadow: 6px 6px 12px #bebebe,\n                -6px -6px 12px #ffffff;\n        }\n\n        .control-btn:active {\n            transform: translateY(1px);\n            box-shadow: inset 4px 4px 8px #bebebe,\n                inset -4px -4px 8px #ffffff;\n        }\n\n        #up {\n            grid-column: 2;\n        }\n\n        #left {\n            grid-column: 1;\n            grid-row: 2;\n        }\n\n        #right {\n            grid-column: 3;\n            grid-row: 2;\n        }\n\n        #down {\n            grid-column: 2;\n            grid-row: 3;\n        }\n    </style>\n</head>\n\n<body>\n    <div class="game-container">\n        <canvas id="gameCanvas" width="300" height="300"></canvas>\n        <div id="gameControls">\n            <div id="gameScore">\n                <div id="score">得分: 0</div>\n                <button id="startBtn">开始游戏</button>\n            </div>\n            <div class="controls">\n                <button id="up" class="control-btn" onclick="changeDirectionByButton(\'up\')">↑</button>\n                <button id="left" class="control-btn" onclick="changeDirectionByButton(\'left\')">←</button>\n                <button id="right" class="control-btn" onclick="changeDirectionByButton(\'right\')">→</button>\n                <button id="down" class="control-btn" onclick="changeDirectionByButton(\'down\')">↓</button>\n            </div>\n        </div>\n    </div>\n    <script>\n        const canvas = document.getElementById(\'gameCanvas\');\n        const ctx = canvas.getContext(\'2d\');\n        const scoreElement = document.getElementById(\'score\');\n        const startBtn = document.getElementById(\'startBtn\');\n\n        const gridSize = 15;\n        const tileCount = canvas.width / gridSize;\n\n        let snake = [{ x: 10, y: 10 }];\n        let food = { x: 15, y: 15 };\n        let dx = 0;\n        let dy = 0;\n        let score = 0;\n        let gameRunning = false;\n\n        function drawGame() {\n            if (!gameRunning) return;\n\n            clearCanvas();\n            moveSnake();\n            drawSnake();\n            drawFood();\n            checkCollision();\n            updateScore();\n            setTimeout(drawGame, 200);\n        }\n\n        function clearCanvas() {\n            ctx.fillStyle = \'#f0f0f0\';\n            ctx.fillRect(0, 0, canvas.width, canvas.height);\n        }\n\n        function moveSnake() {\n            const head = { x: snake[0].x + dx, y: snake[0].y + dy };\n            snake.unshift(head);\n\n            if (head.x === food.x && head.y === food.y) {\n                generateFood();\n                score += 10;\n            } else {\n                snake.pop();\n            }\n        }\n\n        function drawSnake() {\n            snake.forEach((segment, index) => {\n                const gradient = ctx.createLinearGradient(\n                    segment.x * gridSize,\n                    segment.y * gridSize,\n                    (segment.x + 1) * gridSize,\n                    (segment.y + 1) * gridSize\n                );\n                gradient.addColorStop(0, \'#4CAF50\');\n                gradient.addColorStop(1, \'#45a049\');\n                ctx.fillStyle = gradient;\n                ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);\n\n                if (index === 0) {\n                    // Draw eyes\n                    ctx.fillStyle = \'white\';\n                    ctx.beginPath();\n                    ctx.arc(segment.x * gridSize + 5, segment.y * gridSize + 5, 2, 0, 2 * Math.PI);\n                    ctx.arc(segment.x * gridSize + 10, segment.y * gridSize + 5, 2, 0, 2 * Math.PI);\n                    ctx.fill();\n                }\n            });\n        }\n\n        function drawFood() {\n            const gradient = ctx.createRadialGradient(\n                food.x * gridSize + gridSize / 2,\n                food.y * gridSize + gridSize / 2,\n                2,\n                food.x * gridSize + gridSize / 2,\n                food.y * gridSize + gridSize / 2,\n                gridSize / 2\n            );\n            gradient.addColorStop(0, \'#ff6b6b\');\n            gradient.addColorStop(1, \'#ee5253\');\n            ctx.fillStyle = gradient;\n            ctx.beginPath();\n            ctx.arc(food.x * gridSize + gridSize / 2, food.y * gridSize + gridSize / 2, gridSize / 2 - 1, 0, 2 * Math.PI);\n            ctx.fill();\n        }\n\n        function generateFood() {\n            food.x = Math.floor(Math.random() * tileCount);\n            food.y = Math.floor(Math.random() * tileCount);\n        }\n\n        function checkCollision() {\n            const head = snake[0];\n\n            if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {\n                gameOver();\n            }\n\n            for (let i = 1; i < snake.length; i++) {\n                if (head.x === snake[i].x && head.y === snake[i].y) {\n                    gameOver();\n                }\n            }\n        }\n\n        function gameOver() {\n            gameRunning = false;\n            startBtn.textContent = \'重新开始\';\n            startBtn.style.display = \'inline-block\';\n            alert(`游戏结束！你的得分是: ${score}`);\n        }\n\n        function updateScore() {\n            scoreElement.textContent = `得分: ${score}`;\n        }\n\n        function resetGame() {\n            snake = [{ x: 10, y: 10 }];\n            food = { x: 15, y: 15 };\n            dx = 0;\n            dy = 0;\n            score = 0;\n            updateScore();\n        }\n\n        document.addEventListener(\'keydown\', changeDirection);\n\n        function changeDirection(event) {\n            const LEFT_KEY = 37;\n            const RIGHT_KEY = 39;\n            const UP_KEY = 38;\n            const DOWN_KEY = 40;\n\n            const keyPressed = event.keyCode;\n\n            const goingUp = dy === -1;\n            const goingDown = dy === 1;\n            const goingRight = dx === 1;\n            const goingLeft = dx === -1;\n\n            if (keyPressed === LEFT_KEY && !goingRight) {\n                dx = -1;\n                dy = 0;\n            }\n\n            if (keyPressed === UP_KEY && !goingDown) {\n                dx = 0;\n                dy = -1;\n            }\n\n            if (keyPressed === RIGHT_KEY && !goingLeft) {\n                dx = 1;\n                dy = 0;\n            }\n\n            if (keyPressed === DOWN_KEY && !goingUp) {\n                dx = 0;\n                dy = 1;\n            }\n        }\n\n        function changeDirectionByButton(direction) {\n            if (direction === \'left\' && dx !== 1) {\n                dx = -1;\n                dy = 0;\n            } else if (direction === \'up\' && dy !== 1) {\n                dx = 0;\n                dy = -1;\n            } else if (direction === \'down\' && dy !== -1) {\n                dx = 0;\n                dy = 1;\n            } else if (direction === \'right\' && dx !== -1) {\n                dx = 1;\n                dy = 0;\n            }\n        }\n\n        startBtn.addEventListener(\'click\', () => {\n            resetGame();\n            gameRunning = true;\n            startBtn.style.display = \'none\';\n            drawGame();\n        });\n\n        clearCanvas();\n    </script>\n</body>\n\n</html>\n```\n\n这个改进版本包含以下UI和功能增强：\n\n1. 添加了方向按键，使游戏可以在移动设备上玩\n2. 添加了居中的游戏容器，使游戏在页面上更加美观。\n3. 改进了Canvas的样式，添加了边框和阴影效果。\n4. 添加了得分显示。\n5. 添加了开始/重新开始按钮。\n6. 为蛇和食物添加了渐变色，使其看起来更有立体感。\n7. 为蛇头部添加了眼睛，增加了趣味性。\n8. 将食物改为圆形，并添加了渐变效果。\n9. 添加了游戏结束时的提示。\n9. 改进了整体的配色方案，使用了更柔和的颜色。\n\n这个版本的UI更加美观，游戏体验也更好。你可以将这段代码保存为HTML文件并在浏览器中打开来玩游戏。点击"开始游戏"按钮开始，使用方向键来控制蛇的移动方向。\n\n希望这个改进版本能满足你的需求！如果你还有任何问题或需要进一步的修改，请随时告诉我。',
      role: 'assistant' as const,
      timestamp: 1721205944862,
      generating: false,
      wordCount: 1303,
      tokenCount: 2973,
      aiProvider: 'chatbox-ai',
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 3165,
    },
  ].map(migrateMessage),
  threadName: 'HTMLchat',
  threads: [],
}

export const artifactSessionEN: Session = {
  id: 'chatbox-chat-demo-artifact-1-en',
  name: 'Snake Game (Artifact Example)',
  type: 'chat',
  picUrl: 'https://download.chatboxai.app/image-demo/snake_game.png',
  messages: [
    {
      id: '0104fabe-564a-4b99-b9e3-24c34a6805b2',
      role: 'system' as const,
      content:
        'You are a skilled developer proficient in HTML/JS/CSS/TailwindCSS. Please use these technologies to create the page I need.',
      wordCount: 21,
      tokenCount: 35,
      timestamp: 1721205396827,
    },
    {
      id: 'e2703f79-ed98-403b-adeb-6c74425607de',
      content: 'Write a Snake game',
      role: 'user' as const,
      timestamp: 1721205559391,
      wordCount: 8,
      tokenCount: 19,
    },
    {
      id: 'ef9f09f1-5096-43c6-b726-e5f32649435d',
      content:
        'Sure, I can help you write a simple Snake game. Here\'s the complete HTML, CSS, and JavaScript code:\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Snake Game</title>\n    <style>\n        #gameCanvas {\n            border: 1px solid black;\n        }\n    </style>\n</head>\n<body>\n    <canvas id="gameCanvas" width="400" height="400"></canvas>\n    <script>\n        const canvas = document.getElementById(\'gameCanvas\');\n        const ctx = canvas.getContext(\'2d\');\n\n        const gridSize = 20;\n        const tileCount = canvas.width / gridSize;\n\n        let snake = [\n            {x: 10, y: 10},\n        ];\n        let food = {x: 15, y: 15};\n        let dx = 0;\n        let dy = 0;\n\n        function drawGame() {\n            clearCanvas();\n            moveSnake();\n            drawSnake();\n            drawFood();\n            checkCollision();\n            setTimeout(drawGame, 100);\n        }\n\n        function clearCanvas() {\n            ctx.fillStyle = \'white\';\n            ctx.fillRect(0, 0, canvas.width, canvas.height);\n        }\n\n        function moveSnake() {\n            const head = {x: snake[0].x + dx, y: snake[0].y + dy};\n            snake.unshift(head);\n\n            if (head.x === food.x && head.y === food.y) {\n                generateFood();\n            } else {\n                snake.pop();\n            }\n        }\n\n        function drawSnake() {\n            ctx.fillStyle = \'green\';\n            snake.forEach(segment => {\n                ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);\n            });\n        }\n\n        function drawFood() {\n            ctx.fillStyle = \'red\';\n            ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);\n        }\n\n        function generateFood() {\n            food.x = Math.floor(Math.random() * tileCount);\n            food.y = Math.floor(Math.random() * tileCount);\n        }\n\n        function checkCollision() {\n            const head = snake[0];\n\n            if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {\n                resetGame();\n            }\n\n            for (let i = 1; i < snake.length; i++) {\n                if (head.x === snake[i].x && head.y === snake[i].y) {\n                    resetGame();\n                }\n            }\n        }\n\n        function resetGame() {\n            snake = [{x: 10, y: 10}];\n            food = {x: 15, y: 15};\n            dx = 0;\n            dy = 0;\n        }\n\n        document.addEventListener(\'keydown\', changeDirection);\n\n        function changeDirection(event) {\n            const LEFT_KEY = 37;\n            const RIGHT_KEY = 39;\n            const UP_KEY = 38;\n            const DOWN_KEY = 40;\n\n            const keyPressed = event.keyCode;\n\n            const goingUp = dy === -1;\n            const goingDown = dy === 1;\n            const goingRight = dx === 1;\n            const goingLeft = dx === -1;\n\n            if (keyPressed === LEFT_KEY && !goingRight) {\n                dx = -1;\n                dy = 0;\n            }\n\n            if (keyPressed === UP_KEY && !goingDown) {\n                dx = 0;\n                dy = -1;\n            }\n\n            if (keyPressed === RIGHT_KEY && !goingLeft) {\n                dx = 1;\n                dy = 0;\n            }\n\n            if (keyPressed === DOWN_KEY && !goingUp) {\n                dx = 0;\n                dy = 1;\n            }\n        }\n\n        drawGame();\n    </script>\n</body>\n</html>\n```\n\nThis Snake game includes the following features:\n\n1. Uses Canvas to draw the game interface.\n2. The snake can move and eat food.\n3. Food is generated randomly.\n4. The game resets when the snake hits a wall or itself.\n5. Use the arrow keys to control the movement of the snake.\n\nYou can save this code as an HTML file and open it in a browser to play the game. Use the arrow keys to control the direction of the snake\'s movement.\n\nIf you want to further improve this game, consider adding the following features:\n\n1. Scoring system.\n2. Game start and end screens.\n3. Difficulty selection (by adjusting the speed of the snake).\n4. Sound effects.\n5. Better visual effects (such as gradients, images, etc.).\n\nHope this example helps! If you have any questions or need further explanation, feel free to ask me.',
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },
    {
      id: 'a2c3edf2-3771-42bf-bd62-dfca2b9fcd65',
      content:
        'Please make the following improvements:\n\n1. Add directional buttons so the game can be played on touchscreen phones.\n2. Add a scoring system.\n3. Add "Start Game" and "Restart Game" buttons.\n4. Redesign the UI style.\n',
      role: 'user' as const,
      timestamp: 1721206033930,
      wordCount: 55,
      tokenCount: 72,
    },
    {
      id: '5096fc82-1463-4890-8a4f-8cef6c2344ab',
      content:
        'Sure, I can help you improve the UI. Here\'s an updated version with some visual effects and game controls:\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Snake Game</title>\n    <style>\n        body {\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            height: 100vh;\n            margin: 0;\n            background-color: #f0f0f0;\n            font-family: Arial, sans-serif;\n        }\n\n        .game-container {\n            text-align: center;\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            max-width: 100%;\n            flex-wrap: wrap;\n        }\n\n        #gameCanvas {\n            border: 2px solid #333;\n            border-radius: 5px;\n            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);\n            margin: 0 auto;\n        }\n\n        #gameControls {\n            text-align: center;\n            margin: 0 auto;\n            padding: 0 8px;\n        }\n\n        #gameScore {\n            display: flex;\n            flex-direction: column;\n            align-items: center;\n            justify-content: center;\n        }\n\n        #score {\n            font-size: 24px;\n            margin: 10px 0;\n        }\n\n        #startBtn {\n            font-size: 18px;\n            padding: 12px 24px;\n            background: linear-gradient(145deg, #f0f0f0, #cacaca);\n            color: #333;\n            border: none;\n            border-radius: 10px;\n            cursor: pointer;\n            transition: all 0.3s ease;\n            box-shadow: 5px 5px 10px #bebebe,\n                -5px -5px 10px #ffffff;\n            position: relative;\n            overflow: hidden;\n            font-weight: bold;\n            text-transform: uppercase;\n            letter-spacing: 1px;\n        }\n\n        #startBtn::before {\n            content: \'\';\n            position: absolute;\n            top: 2px;\n            left: 2px;\n            right: 2px;\n            bottom: 50%;\n            background: linear-gradient(180deg, rgba(255, 255, 255, 0.3), transparent);\n            border-radius: 8px 8px 0 0;\n            pointer-events: none;\n        }\n\n        #startBtn:hover {\n            transform: translateY(-2px);\n            box-shadow: 6px 6px 12px #bebebe,\n                -6px -6px 12px #ffffff;\n            background: linear-gradient(145deg, #f5f5f5, #d0d0d0);\n        }\n\n        #startBtn:active {\n            transform: translateY(1px);\n            box-shadow: inset 4px 4px 8px #bebebe,\n                inset -4px -4px 8px #ffffff;\n            background: linear-gradient(145deg, #e6e6e6, #c0c0c0);\n        }\n\n        .controls {\n            display: grid;\n            grid-template-columns: repeat(3, 1fr);\n            gap: 10px;\n            width: 180px;\n            margin: 20px auto;\n        }\n\n        .control-btn {\n            width: 60px;\n            height: 60px;\n            font-size: 24px;\n            background: linear-gradient(145deg, #f0f0f0, #cacaca);\n            color: #333;\n            border: none;\n            border-radius: 50%;\n            cursor: pointer;\n            transition: all 0.3s ease;\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            box-shadow: 5px 5px 10px #bebebe,\n                -5px -5px 10px #ffffff;\n            position: relative;\n            overflow: hidden;\n        }\n\n        .control-btn::before {\n            content: \'\';\n            position: absolute;\n            top: 5%;\n            left: 5%;\n            right: 5%;\n            bottom: 5%;\n            border-radius: 50%;\n            z-index: -1;\n        }\n\n        .control-btn:hover {\n            transform: translateY(-2px);\n            box-shadow: 6px 6px 12px #bebebe,\n                -6px -6px 12px #ffffff;\n        }\n\n        .control-btn:active {\n            transform: translateY(1px);\n            box-shadow: inset 4px 4px 8px #bebebe,\n                inset -4px -4px 8px #ffffff;\n        }\n\n        #up {\n            grid-column: 2;\n        }\n\n        #left {\n            grid-column: 1;\n            grid-row: 2;\n        }\n\n        #right {\n            grid-column: 3;\n            grid-row: 2;\n        }\n\n        #down {\n            grid-column: 2;\n            grid-row: 3;\n        }\n    </style>\n</head>\n\n<body>\n    <div class="game-container">\n        <canvas id="gameCanvas" width="300" height="300"></canvas>\n        <div id="gameControls">\n            <div id="gameScore">\n                <div id="score">Score: 0</div>\n                <button id="startBtn">Start</button>\n            </div>\n            <div class="controls">\n                <button id="up" class="control-btn" onclick="changeDirectionByButton(\'up\')">↑</button>\n                <button id="left" class="control-btn" onclick="changeDirectionByButton(\'left\')">←</button>\n                <button id="right" class="control-btn" onclick="changeDirectionByButton(\'right\')">→</button>\n                <button id="down" class="control-btn" onclick="changeDirectionByButton(\'down\')">↓</button>\n            </div>\n        </div>\n    </div>\n    <script>\n        const canvas = document.getElementById(\'gameCanvas\');\n        const ctx = canvas.getContext(\'2d\');\n        const scoreElement = document.getElementById(\'score\');\n        const startBtn = document.getElementById(\'startBtn\');\n\n        const gridSize = 15;\n        const tileCount = canvas.width / gridSize;\n\n        let snake = [{ x: 10, y: 10 }];\n        let food = { x: 15, y: 15 };\n        let dx = 0;\n        let dy = 0;\n        let score = 0;\n        let gameRunning = false;\n\n        function drawGame() {\n            if (!gameRunning) return;\n\n            clearCanvas();\n            moveSnake();\n            drawSnake();\n            drawFood();\n            checkCollision();\n            updateScore();\n            setTimeout(drawGame, 200);\n        }\n\n        function clearCanvas() {\n            ctx.fillStyle = \'#f0f0f0\';\n            ctx.fillRect(0, 0, canvas.width, canvas.height);\n        }\n\n        function moveSnake() {\n            const head = { x: snake[0].x + dx, y: snake[0].y + dy };\n            snake.unshift(head);\n\n            if (head.x === food.x && head.y === food.y) {\n                generateFood();\n                score += 10;\n            } else {\n                snake.pop();\n            }\n        }\n\n        function drawSnake() {\n            snake.forEach((segment, index) => {\n                const gradient = ctx.createLinearGradient(\n                    segment.x * gridSize,\n                    segment.y * gridSize,\n                    (segment.x + 1) * gridSize,\n                    (segment.y + 1) * gridSize\n                );\n                gradient.addColorStop(0, \'#4CAF50\');\n                gradient.addColorStop(1, \'#45a049\');\n                ctx.fillStyle = gradient;\n                ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);\n\n                if (index === 0) {\n                    // Draw eyes\n                    ctx.fillStyle = \'white\';\n                    ctx.beginPath();\n                    ctx.arc(segment.x * gridSize + 5, segment.y * gridSize + 5, 2, 0, 2 * Math.PI);\n                    ctx.arc(segment.x * gridSize + 10, segment.y * gridSize + 5, 2, 0, 2 * Math.PI);\n                    ctx.fill();\n                }\n            });\n        }\n\n        function drawFood() {\n            const gradient = ctx.createRadialGradient(\n                food.x * gridSize + gridSize / 2,\n                food.y * gridSize + gridSize / 2,\n                2,\n                food.x * gridSize + gridSize / 2,\n                food.y * gridSize + gridSize / 2,\n                gridSize / 2\n            );\n            gradient.addColorStop(0, \'#ff6b6b\');\n            gradient.addColorStop(1, \'#ee5253\');\n            ctx.fillStyle = gradient;\n            ctx.beginPath();\n            ctx.arc(food.x * gridSize + gridSize / 2, food.y * gridSize + gridSize / 2, gridSize / 2 - 1, 0, 2 * Math.PI);\n            ctx.fill();\n        }\n\n        function generateFood() {\n            food.x = Math.floor(Math.random() * tileCount);\n            food.y = Math.floor(Math.random() * tileCount);\n        }\n\n        function checkCollision() {\n            const head = snake[0];\n\n            if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {\n                gameOver();\n            }\n\n            for (let i = 1; i < snake.length; i++) {\n                if (head.x === snake[i].x && head.y === snake[i].y) {\n                    gameOver();\n                }\n            }\n        }\n\n        function gameOver() {\n            gameRunning = false;\n            startBtn.textContent = \'Restart\';\n            startBtn.style.display = \'inline-block\';\n        }\n\n        function updateScore() {\n            scoreElement.textContent = `Score: ${score}`;\n        }\n\n        function resetGame() {\n            snake = [{ x: 10, y: 10 }];\n            food = { x: 15, y: 15 };\n            dx = 0;\n            dy = 0;\n            score = 0;\n            updateScore();\n        }\n\n        document.addEventListener(\'keydown\', changeDirection);\n\n        function changeDirection(event) {\n            const LEFT_KEY = 37;\n            const RIGHT_KEY = 39;\n            const UP_KEY = 38;\n            const DOWN_KEY = 40;\n\n            const keyPressed = event.keyCode;\n\n            const goingUp = dy === -1;\n            const goingDown = dy === 1;\n            const goingRight = dx === 1;\n            const goingLeft = dx === -1;\n\n            if (keyPressed === LEFT_KEY && !goingRight) {\n                dx = -1;\n                dy = 0;\n            }\n\n            if (keyPressed === UP_KEY && !goingDown) {\n                dx = 0;\n                dy = -1;\n            }\n\n            if (keyPressed === RIGHT_KEY && !goingLeft) {\n                dx = 1;\n                dy = 0;\n            }\n\n            if (keyPressed === DOWN_KEY && !goingUp) {\n                dx = 0;\n                dy = 1;\n            }\n        }\n\n        function changeDirectionByButton(direction) {\n            if (direction === \'left\' && dx !== 1) {\n                dx = -1;\n                dy = 0;\n            } else if (direction === \'up\' && dy !== 1) {\n                dx = 0;\n                dy = -1;\n            } else if (direction === \'down\' && dy !== -1) {\n                dx = 0;\n                dy = 1;\n            } else if (direction === \'right\' && dx !== -1) {\n                dx = 1;\n                dy = 0;\n            }\n        }\n\n        startBtn.addEventListener(\'click\', () => {\n            resetGame();\n            gameRunning = true;\n            startBtn.style.display = \'none\';\n            drawGame();\n        });\n\n        clearCanvas();\n    </script>\n</body>\n\n</html>\n```\n\nThis updated version includes the following UI and functionality enhancements:\n\n1. Added directional buttons, making the game playable on mobile devices.\n2. Added a centered game container for a more aesthetic page layout.\n3. Improved the Canvas style with borders and shadow effects.\n4. Added a score display.\n5. Added a start/restart button.\n6. Added gradient colors to the snake and food for a more three-dimensional look.\n7. Added eyes to the snake\'s head for added fun.\n8. Changed the food to a circular shape with gradient effects.\n9. Added a game-over prompt.\n10. Improved the overall color scheme with softer colors.\n\nThis version offers a more visually appealing UI and a better gaming experience. You can save this code as an HTML file and open it in a browser to play the game. Click the "Start Game" button to begin and use the arrow keys to control the direction of the snake.\n\nI hope this updated version meets your needs! If you have any more questions or need further modifications, feel free to let me know.',
      role: 'assistant' as const,
      timestamp: 1721205944862,
      generating: false,
      wordCount: 1303,
      tokenCount: 2973,
      aiProvider: 'chatbox-ai',
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 3165,
    },
  ].map(migrateMessage),
  threadName: 'HTMLchat',
  threads: [],
}

export const mermaidSessionEN: Session = {
  id: 'mermaid-demo-1-en',
  name: 'ChartWhiz',
  type: 'chat',
  picUrl: 'https://download.chatboxai.app/image-demo/chartwhiz.png',
  messages: [
    {
      id: '0001fabe-564a-4b99-b9e3-24c34a6805b2',
      role: 'system' as const,
      content: `You are an AI assistant skilled in using Mermaid diagrams to explain concepts and answer questions. When responding to user queries, please follow these guidelines:
1. Analyze the user's question to determine if a diagram would be suitable for explanation or answering. Suitable scenarios for using diagrams include, but are not limited to: process descriptions, hierarchical structures, timelines, relationship maps, etc.
2. If you decide to use a diagram, choose the most appropriate type of Mermaid diagram, such as Flowchart, Sequence Diagram, Class Diagram, State Diagram, Entity Relationship Diagram, User Journey, Gantt, Pie Chart, Quadrant Chart, Requirement Diagram, Gitgraph (Git) Diagram, C4 Diagram, Mindmaps, Timeline, Zenuml, Sankey, XYChart, Block Diagram, etc.
3. Write the diagram code using Mermaid syntax, ensuring the syntax is correct. Place the diagram code between  and .
4. Provide textual explanations before and after the diagram, explaining the content and key points of the diagram.
5. If the question is complex, use multiple diagrams to explain different aspects.
6. Ensure the diagram is clear and concise, avoiding over-complication or information overload.
7. Where appropriate, combine textual description and diagrams to comprehensively answer the question.
8. If the user's question is not suitable for a diagram, answer in a conventional manner without forcing the use of a diagram.
Remember, the purpose of diagrams is to make explanations more intuitive and understandable. When using diagrams, always aim to enhance the clarity and comprehensiveness of your responses.`,
    },

    {
      id: '00023f79-ed98-403b-adeb-6c74425607de',
      content: 'Explain TCP?',
      role: 'user' as const,
    },
    {
      id: '000309f1-5096-43c6-b726-e5f32649435d',
      content: `
TCP, or Transmission Control Protocol, is a core protocol of the Internet Protocol Suite. It operates at the transport layer and is used to provide a reliable, ordered, and error-checked delivery of a stream of data between applications running on hosts communicating over an IP network.

Here's how TCP works, summarized in a sequence diagram:

\`\`\`mermaid
sequenceDiagram
    participant A as Application A
    participant TCP_A as TCP Layer A
    participant TCP_B as TCP Layer B
    participant B as Application B
    A->>TCP_A: Send data
    TCP_A->>TCP_B: SYN (Synchronize/Start)
    TCP_B->>TCP_A: SYN-ACK (Acknowledge)
    TCP_A->>TCP_B: ACK
    TCP_A->>TCP_B: Data packets
    TCP_B->>TCP_A: ACK for received packets
    TCP_A->>TCP_B: FIN (Finish)
    TCP_B->>TCP_A: ACK for FIN
    TCP_B->>TCP_A: FIN
    TCP_A->>TCP_B: ACK for FIN
    TCP_A->>A: Connection closed
    TCP_B->>B: Connection closed
\`\`\`

### Key Aspects of TCP:

1. **Connection-Oriented**: TCP establishes a connection before data can be sent.
2. **Reliable Delivery**: It ensures data is delivered correctly and in order, resending packets if necessary.
3. **Flow Control**: TCP uses window size adjustments to control how much data can be in transit.
4. **Congestion Control**: It reduces data transmission rate when network congestion is detected.
5. **Error Checking**: Uses checksums to ensure that data is not corrupted during transmission.

The sequence diagram above illustrates the typical TCP connection establishment (handshake), data transfer, and connection termination phases. This three-way handshake process is essential for establishing a reliable connection state between two devices.

If you need more details on any specific part of the TCP protocol or its practical applications, feel free to ask!
            `,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },

    {
      id: '00043f79-ed98-403b-adeb-6c74425607de',
      content: 'Explain the normal distribution',
      role: 'user' as const,
    },
    {
      id: '000509f1-5096-43c6-b726-e5f32649435d',
      content: `Certainly! I'd be happy to explain the normal distribution, also known as the Gaussian distribution. It's a fundamental concept in statistics and probability theory. Let me provide you with an explanation along with a helpful diagram to visualize the key characteristics.

\`\`\`mermaid
xychart-beta
    title "Normal Distribution"
    x-axis [-3, -2, -1, 0, 1, 2, 3]
    y-axis "Probability Density" 0 --> 0.4
    bar [0.004, 0.054, 0.242, 0.399, 0.242, 0.054, 0.004]
    line [0.004, 0.054, 0.242, 0.399, 0.242, 0.054, 0.004]
\`\`\`

The normal distribution is a continuous probability distribution that is symmetric about its mean, with a bell-shaped curve. It's characterized by two parameters: the mean (μ) and the standard deviation (σ). Here are the key points:

1. Shape: The distribution is bell-shaped and symmetrical.
2. Mean, Median, and Mode: In a normal distribution, these three measures of central tendency are all equal.
3. Symmetry: The curve is perfectly symmetrical about the mean.
4. Tails: The tails of the distribution extend infinitely in both directions but approach zero as they do so.
5. Standard Deviations: About 68% of the data falls within one standard deviation of the mean, 95% within two standard deviations, and 99.7% within three standard deviations.

Let's visualize this with a diagram:

This diagram represents a standard normal distribution, where:
- The x-axis shows the number of standard deviations from the mean (0).
- The y-axis represents the probability density.
- The bell-shaped curve is clearly visible.

Key observations from the diagram:
1. The peak of the curve is at the center (0), which represents the mean, median, and mode.
2. The curve is symmetrical on both sides of the center.
3. The tails of the distribution extend outwards, getting closer to the x-axis but never touching it.
4. The area between -1 and 1 (one standard deviation on either side of the mean) contains about 68% of the total area under the curve.

The normal distribution is widely used in various fields, including natural and social sciences, to represent real-valued random variables whose distributions are not known. It's particularly useful because many natural phenomena can be approximated by this distribution, and it has mathematical properties that make it convenient for statistical analysis and modeling.

Understanding the normal distribution is crucial for many statistical techniques, including hypothesis testing, confidence intervals, and regression analysis. It forms the basis for many advanced statistical concepts and is a cornerstone of probability theory and statistics.`,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },

    {
      id: '00063f79-ed98-403b-adeb-6c74425607de',
      content: 'How to master algebra? Please provide a simple answer using a mind map',
      role: 'user' as const,
    },
    {
      id: '000709f1-5096-43c6-b726-e5f32649435d',
      content: `
Certainly! I'll create a simple mind map to illustrate the key steps to master algebra. This mind map will give you a clear overview of the important aspects to focus on.

\`\`\`mermaid
mindmap
  root((Mastering Algebra))
    Fundamentals
      Basic operations
      Order of operations
      Properties of numbers
    Equations
      Linear equations
      Quadratic equations
      Systems of equations
    Functions
      Graphing
      Types of functions
      Transformations
    Practice
      Regular exercises
      Real-world applications
      Problem-solving strategies
    Resources
      Textbooks
      Online courses
      Tutoring
\`\`\`

This mind map outlines a simple approach to mastering algebra. Here's a brief explanation of each main branch:

1. Fundamentals: Start by solidifying your understanding of basic operations, order of operations, and properties of numbers. These form the foundation of algebraic thinking.
2. Equations: Learn how to solve various types of equations, including linear, quadratic, and systems of equations. This is a core skill in algebra.
3. Functions: Understand different types of functions, how to graph them, and how to apply transformations. This helps in visualizing algebraic relationships.
4. Practice: Regular practice is crucial. Solve exercises, apply algebra to real-world problems, and develop problem-solving strategies.
5. Resources: Utilize various learning resources such as textbooks, online courses, and tutoring to support your learning journey.

By focusing on these key areas and progressively building your skills, you can work towards mastering algebra. Remember that consistent practice and patience are key to success in mathematics.
            `,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },
  ].map(migrateMessage),
  threadName: 'Charts',
  threads: [],
}

export const mermaidSessionCN: Session = {
  id: 'mermaid-demo-1-cn',
  name: '做图表',
  type: 'chat',
  picUrl: 'https://download.chatboxai.app/image-demo/chartwhiz.png',
  messages: [
    {
      id: '0011fabe-564a-4b99-b9e3-24c34a6805b2',
      role: 'system' as const,
      content: `You are an AI assistant skilled in using Mermaid diagrams to explain concepts and answer questions. When responding to user queries, please follow these guidelines:
1. Analyze the user's question to determine if a diagram would be suitable for explanation or answering. Suitable scenarios for using diagrams include, but are not limited to: process descriptions, hierarchical structures, timelines, relationship maps, etc.
2. If you decide to use a diagram, choose the most appropriate type of Mermaid diagram, such as Flowchart, Sequence Diagram, Class Diagram, State Diagram, Entity Relationship Diagram, User Journey, Gantt, Pie Chart, Quadrant Chart, Requirement Diagram, Gitgraph (Git) Diagram, C4 Diagram, Mindmaps, Timeline, Zenuml, Sankey, XYChart, Block Diagram, etc.
3. Write the diagram code using Mermaid syntax, ensuring the syntax is correct. Place the diagram code between  and .
4. Provide textual explanations before and after the diagram, explaining the content and key points of the diagram.
5. If the question is complex, use multiple diagrams to explain different aspects.
6. Ensure the diagram is clear and concise, avoiding over-complication or information overload.
7. Where appropriate, combine textual description and diagrams to comprehensively answer the question.
8. If the user's question is not suitable for a diagram, answer in a conventional manner without forcing the use of a diagram.
Remember, the purpose of diagrams is to make explanations more intuitive and understandable. When using diagrams, always aim to enhance the clarity and comprehensiveness of your responses.`,
    },

    {
      id: '00123f79-ed98-403b-adeb-6c74425607de',
      content: '解释一下TCP？',
      role: 'user' as const,
    },
    {
      id: '001309f1-5096-43c6-b726-e5f32649435d',
      content: `
TCP，全称传输控制协议（Transmission Control Protocol），是互联网协议套件的核心协议之一。它在传输层运作，用于在通过IP网络通信的主机上运行的应用程序之间提供可靠、有序和经过错误检查的数据流传输。

以下是TCP工作原理的序列图概述：

\`\`\`mermaid
sequenceDiagram
    participant A as 应用程序A
    participant TCP_A as TCP层A
    participant TCP_B as TCP层B
    participant B as 应用程序B
    A->>TCP_A: 发送数据
    TCP_A->>TCP_B: SYN（同步/开始）
    TCP_B->>TCP_A: SYN-ACK（确认）
    TCP_A->>TCP_B: ACK
    TCP_A->>TCP_B: 数据包
    TCP_B->>TCP_A: 接收数据包的ACK
    TCP_A->>TCP_B: FIN（结束）
    TCP_B->>TCP_A: FIN的ACK
    TCP_B->>TCP_A: FIN
    TCP_A->>TCP_B: FIN的ACK
    TCP_A->>A: 连接关闭
    TCP_B->>B: 连接关闭
\`\`\`

### TCP的主要特点：

1. **面向连接**：TCP在发送数据之前建立连接。
2. **可靠传输**：确保数据正确且按顺序传递，必要时重新发送数据包。
3. **流量控制**：通过调整窗口大小来控制传输中的数据量。
4. **拥塞控制**：当检测到网络拥塞时降低数据传输速率。
5. **错误检查**：使用校验和确保数据在传输过程中不被损坏。

上面的序列图展示了典型的TCP连接建立（握手）、数据传输和连接终止阶段。这个三次握手过程对于在两个设备之间建立可靠的连接状态至关重要。

如果你需要了解TCP协议的任何具体部分或其实际应用的更多细节，随时问我！
            `,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },

    {
      id: '00143f79-ed98-403b-adeb-6c74425607de',
      content: '解释一下正态分布',
      role: 'user' as const,
    },
    {
      id: '001509f1-5096-43c6-b726-e5f32649435d',
      content: `当然！我很乐意为你解释正态分布，也称为高斯分布。这是统计学和概率论中的一个基本概念。让我为你提供一个解释，并附上一个有助于可视化关键特征的图表。

\`\`\`mermaid
xychart-beta
    title "正态分布"
    x-axis [-3, -2, -1, 0, 1, 2, 3]
    y-axis "概率密度" 0 --> 0.4
    bar [0.004, 0.054, 0.242, 0.399, 0.242, 0.054, 0.004]
    line [0.004, 0.054, 0.242, 0.399, 0.242, 0.054, 0.004]
\`\`\`

正态分布是一种连续概率分布，其曲线呈钟形，并且关于其平均值对称。它由两个参数来描述：平均值（μ）和标准差（σ）。以下是主要特点：

1. 形状：分布呈钟形，且对称。
2. 平均值、中位数和众数：在正态分布中，这三个中央趋势的测量值都相等。
3. 对称性：曲线关于平均值完全对称。
4. 尾部：分布的尾部向两个方向无限延伸，但随着延伸逐渐接近于零。
5. 标准差：约68%的数据落在平均值一个标准差的范围内，95%落在两个标准差内，99.7%落在三个标准差内。

让我们通过图表来可视化这一点：

这个图表代表了一个标准正态分布，其中：
- x轴显示了距离平均值（0）的标准差数。
- y轴代表概率密度。
- 钟形曲线清晰可见。

从图表中可以观察到的关键点：
1. 曲线的峰值在中心（0），代表平均值、中位数和众数。
2. 曲线在中心两侧对称。
3. 分布的尾部向外延伸，越来越接近x轴但永远不会触及。
4. -1到1之间的区域（平均值两侧各一个标准差）包含了曲线下总面积的约68%。

正态分布在各个领域广泛应用，包括自然科学和社会科学，用于表示分布未知的实值随机变量。它之所以特别有用，是因为许多自然现象可以用这种分布来近似，而且它具有便于统计分析和建模的数学特性。

理解正态分布对于许多统计技术至关重要，包括假设检验、置信区间和回归分析。它是许多高级统计概念的基础，也是概率论和统计学的基石。`,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },

    {
      id: '00163f79-ed98-403b-adeb-6c74425607de',
      content: '怎样掌握代数？请用思维导图给出一个简单的回答',
      role: 'user' as const,
    },
    {
      id: '001709f1-5096-43c6-b726-e5f32649435d',
      content: `
当然！我会使用创建一个简单的思维导图，说明掌握代数的关键步骤。这个思维导图将为你提供需要关注的重要方面的清晰概览。

\`\`\`mermaid
mindmap
  root((掌握代数))
    基础知识
      基本运算
      运算顺序
      数的性质
    方程
      线性方程
      二次方程
      方程组
    函数
      图形绘制
      函数类型
      变换
    练习
      定期做习题
      实际应用
      解题策略
    资源
      教科书
      在线课程
      辅导
\`\`\`

这个思维导图概述了掌握代数的简单方法。以下是对每个主要分支的简要解释：

1. 基础知识：从巩固对基本运算、运算顺序和数的性质的理解开始。这些构成了代数思维的基础。
2. 方程：学习如何解各种类型的方程，包括线性方程、二次方程和方程组。这是代数的核心技能。
3. 函数：理解不同类型的函数，如何绘制它们的图形，以及如何应用变换。这有助于可视化代数关系。
4. 练习：定期练习至关重要。解答习题，将代数应用于实际问题，并发展解题策略。
5. 资源：利用各种学习资源，如教科书、在线课程和辅导，以支持你的学习过程。

通过专注于这些关键领域并逐步建立你的技能，你可以朝着掌握代数的目标努力。记住，持续的练习和耐心是数学成功的关键。
            `,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'chatbox-ai' as any,
      model: 'Chatbox AI 4',
      status: [],
      tokensUsed: 1165,
    },
  ].map(migrateMessage),
  threadName: '图表',
  threads: [],
}

type PresetSessionBlobEntry = NonNullable<ChatBridgeLiveSeedFixture['blobEntries']>[number]

export type PresetSessionBundle = {
  session: Session
  fixtureId?: string
  blobEntries?: PresetSessionBlobEntry[]
}

export type ChatBridgePresetSessionInspectionEntry = {
  fixtureId: string
  fixtureName: string
  sessionId: string
  sessionName: string
  locales: string[]
  messageCount: number
  threadCount: number
  blobEntryCount: number
}

export type ChatBridgeSmokeInspectionSnapshot = {
  schemaVersion: 1
  liveSeeds: ChatBridgeLiveSeedInspectionEntry[]
  presetSessions: ChatBridgePresetSessionInspectionEntry[]
}

function createPresetSessionBundle(session: Session): PresetSessionBundle {
  return { session }
}

function createChatBridgePresetSessionBundles(): PresetSessionBundle[] {
  return getChatBridgeLiveSeedFixtures().map((fixture) => ({
    fixtureId: fixture.id,
    session: {
      id: `chatbox-chat-demo-chatbridge-${fixture.id}`,
      ...structuredClone(fixture.sessionInput),
    },
    ...(fixture.blobEntries
      ? {
          blobEntries: fixture.blobEntries.map((blobEntry) => ({ ...blobEntry })),
        }
      : {}),
  }))
}

const chatBridgePresetSessionBundlesForEN = createChatBridgePresetSessionBundles()
const chatBridgePresetSessionBundlesForCN = createChatBridgePresetSessionBundles()

export function getChatBridgeSmokeInspectionSnapshot(): ChatBridgeSmokeInspectionSnapshot {
  const liveSeeds = getChatBridgeLiveSeedInspectionEntries()
  const presetBundlesByFixtureId = new Map(
    chatBridgePresetSessionBundlesForEN
      .filter((bundle): bundle is PresetSessionBundle & { fixtureId: string } => Boolean(bundle.fixtureId))
      .map((bundle) => [bundle.fixtureId, bundle])
  )

  return {
    schemaVersion: 1,
    liveSeeds,
    presetSessions: liveSeeds.map((fixture) => {
      const presetBundle = presetBundlesByFixtureId.get(fixture.fixtureId)

      return {
        fixtureId: fixture.fixtureId,
        fixtureName: fixture.fixtureName,
        sessionId: presetBundle?.session.id ?? `chatbox-chat-demo-chatbridge-${fixture.fixtureId}`,
        sessionName: presetBundle?.session.name ?? fixture.fixtureName,
        locales: ['en', 'cn'],
        messageCount: presetBundle?.session.messages.length ?? 0,
        threadCount: presetBundle?.session.threads?.length ?? 0,
        blobEntryCount: presetBundle?.blobEntries?.length ?? 0,
      }
    }),
  }
}

export const defaultPresetSessionBundlesForEN: PresetSessionBundle[] = [
  createPresetSessionBundle(imageCreatorSessionForEN),
  ...chatBridgePresetSessionBundlesForEN,
  createPresetSessionBundle(artifactSessionEN),
  createPresetSessionBundle(mermaidSessionEN),
  ...defaultSessionsForEN.map(createPresetSessionBundle),
]

export const defaultPresetSessionBundlesForCN: PresetSessionBundle[] = [
  createPresetSessionBundle(imageCreatorSessionForCN),
  ...chatBridgePresetSessionBundlesForCN,
  createPresetSessionBundle(artifactSessionCN),
  createPresetSessionBundle(mermaidSessionCN),
  ...defaultSessionsForCN.map(createPresetSessionBundle),
]

defaultSessionsForCN.unshift(
  imageCreatorSessionForCN,
  ...chatBridgePresetSessionBundlesForCN.map(({ session }) => session),
  artifactSessionCN,
  mermaidSessionCN
)
defaultSessionsForEN.unshift(
  imageCreatorSessionForEN,
  ...chatBridgePresetSessionBundlesForEN.map(({ session }) => session),
  artifactSessionEN,
  mermaidSessionEN
)
