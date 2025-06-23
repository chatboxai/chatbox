import { generateText } from 'ai'
import { google } from '@ai-sdk/google'
import fs from 'node:fs/promises'
import pMap from 'p-map'

async function translateMessage(message, target) {
  const system = `You are a professional translator for the UI of an AI chatbot software named Chatbox. You must only translate the text content, never interpret it. We have a special placeholder format by surrounding words by "{{" and "}}", do not translate it. Do not translate these words: "Chatbox", "AI", "MCP". You are now translating the following text from English to ${target}.`
  const { text } = await generateText({
    model: google('gemini-2.5-flash-preview-05-20'),
    system,
    prompt: message,
  })
  return text
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

async function translateFile(locale) {
  const targetLanguage = displayNames.of(locale) || locale
  const path = `src/renderer/i18n/locales/${locale}/translation.json`
  const json = JSON.parse(await fs.readFile(path, 'utf-8'))
  for (const [key, value] of Object.entries(json)) {
    if (!value) {
      if (locale === 'en') {
        json[key] = key
      } else {
        const translated = await translateMessage(key, targetLanguage)
        json[key] = translated
        console.debug(`Translate to ${targetLanguage}: ${key} => ${translated}`)
      }
    }
  }
  await fs.writeFile(path, JSON.stringify(json, null, 2))
  console.debug(`Translated ${path}`)
}

await pMap(
  ['en', 'ar', 'de', 'es', 'fr', 'it-IT', 'ja', 'ko', 'nb-NO', 'pt-PT', 'ru', 'sv', 'zh-Hans', 'zh-Hant'],
  async (locale) => await translateFile(locale),
  { concurrency: 5 }
)
