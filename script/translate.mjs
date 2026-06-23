import fs from 'node:fs/promises'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import pMap from 'p-map'

if (!process.env.AIHUBMIX_API_KEY) {
  console.error('Missing AIHUBMIX_API_KEY environment variable')
  process.exit(1)
}

const openai = createOpenAI({
  baseURL: 'https://aihubmix.com/v1',
  apiKey: process.env.AIHUBMIX_API_KEY,
})

async function translateMessage(message, target, keysToTrans, instruction = '') {
  const baseSystem = `You are a professional translator for the UI of an AI chatbot software named Chatbox.
You must only translate the text content, never interpret it.
We have a special placeholder format by surrounding words by "{{" and "}}", do not translate it, also for tags like <0>xxx</0>.
Do not translate these words: "Chatbox", "AI", "MCP", "Deep Link", "ID".

The following contents are not translated for you to better understand the context: ${keysToTrans.join(', ')}.

You are now translating the following text from English to ${target}.
`

  const system = instruction ? `${baseSystem}\n\nAdditional instruction: ${instruction}` : baseSystem
  const { text } = await generateText({
    model: openai('gemini-3.1-flash-lite'),
    system,
    prompt: message,
  })
  return text
}

// Per-locale translation rules. These are always appended to the system prompt
// for the given locale, ensuring consistent terminology across translations.
const localeRules = {
  'zh-Hans': ['Translate "Quota" as "点数"'],
  'zh-Hant': ['Translate "Quota" as "點數"'],
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

async function translateFile(locale, instruction) {
  const targetLanguage = displayNames.of(locale) || locale
  const path = `src/renderer/i18n/locales/${locale}/translation.json`

  // Combine CLI instruction with per-locale rules
  const rules = localeRules[locale] || []
  const allInstructions = [instruction, ...rules].filter(Boolean).join('\n')

  // Read and validate the file first
  const content = await fs.readFile(path, 'utf-8')
  if (!content.trim()) {
    throw new Error(`File ${path} is empty!`)
  }

  const json = JSON.parse(content)

  const keysToTrans = Object.keys(json)
  for (const [key, value] of Object.entries(json)) {
    if (!value) {
      if (locale === 'en') {
        json[key] = key
      } else {
        const translated = await translateMessage(key, targetLanguage, keysToTrans, allInstructions)
        json[key] = translated
        console.debug(`Translate to ${targetLanguage}: ${key} => ${translated}`)
      }
    }
  }

  // Write to a temporary file first, then rename atomically
  const tempPath = `${path}.tmp`
  const newContent = JSON.stringify(json, null, 2)
  await fs.writeFile(tempPath, newContent)
  await fs.rename(tempPath, path)

  console.debug(`Translated ${path}`)
}

const instruction = process.argv[2] || ''

try {
  await pMap(
    ['en', 'ar', 'de', 'es', 'fa', 'fr', 'it-IT', 'ja', 'ko', 'nb-NO', 'pt-PT', 'ru', 'sv', 'zh-Hans', 'zh-Hant'],
    async (locale) => {
      try {
        await translateFile(locale, instruction)
        console.log(`✓ Translated ${locale}`)
      } catch (error) {
        console.error(`✗ Failed to translate ${locale}:`, error.message)
        throw error // Re-throw to stop other translations
      }
    },
    { concurrency: 3 }
  )
  console.log('\n✓ All translations completed successfully!')
} catch (error) {
  console.error('\n✗ Translation failed:', error.message)
  console.error(
    '\nTip: If files were corrupted, restore them with: git checkout src/renderer/i18n/locales/*/translation.json'
  )
  process.exit(1)
}
