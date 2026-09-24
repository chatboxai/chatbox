import fs from 'node:fs/promises'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject, generateText } from 'ai'
import pMap from 'p-map'
import { z } from 'zod'
import { doNotTranslateLine, glossaryIssues, translateAsRules } from './i18n-glossary.mjs'
import { groupKeys, scanKeyFileIndex, scanKeyRoles } from './lib/i18n-context.mjs'

const LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'id', 'it-IT', 'ja', 'ko', 'nb-NO', 'pt-PT', 'ru', 'sv', 'zh-Hans', 'zh-Hant']

// --- CLI args ---
const argv = process.argv.slice(2)
const PRINT_GROUPS = argv.includes('--print-groups')
// --retranslate <csv>: re-translate ALL keys for the listed locales (red-line
// exception, see plan.md §12). Otherwise behaviour stays "only translate empties".
const consumed = new Set()
argv.forEach((a, i) => a.startsWith('--') && consumed.add(i))
const reIdx = argv.indexOf('--retranslate')
const RETRANSLATE = new Set()
if (reIdx >= 0 && argv[reIdx + 1]) {
  consumed.add(reIdx + 1)
  for (const l of argv[reIdx + 1].split(',')) {
    const t = l.trim()
    if (t) RETRANSLATE.add(t)
  }
}
RETRANSLATE.delete('en') // en is the source — never re-translate it
// instruction = first positional arg not consumed by a flag
const instruction = argv.find((a, i) => !consumed.has(i)) || ''

if (!PRINT_GROUPS && !process.env.AIHUBMIX_API_KEY) {
  console.error('Missing AIHUBMIX_API_KEY environment variable')
  process.exit(1)
}

const openai = createOpenAI({
  baseURL: 'https://aihubmix.com/v1',
  apiKey: process.env.AIHUBMIX_API_KEY,
})

const MODEL = 'gemini-3.1-flash-lite'

function baseSystemFor(target) {
  return `You are a professional translator for the UI of an AI chatbot software named Chatbox.
You must only translate the text content, never interpret it.
We have a special placeholder format by surrounding words by "{{" and "}}", do not translate it, also for tags like <0>xxx</0>.
${doNotTranslateLine()}
You are translating UI strings from English to ${target}.`
}

// Per-key fallback for keys a batch call dropped or failed on.
async function translateMessage(message, target, instruction = '') {
  const base = baseSystemFor(target)
  const system = instruction ? `${base}\n\nAdditional instruction: ${instruction}` : base
  const { text } = await generateText({ model: openai(MODEL), system, prompt: message })
  return text
}

const batchSchema = z.object({
  translations: z.array(z.object({ id: z.number(), text: z.string() })),
})

// Translate one group of keys in a single request, with UI-location context and
// already-translated siblings for terminology consistency. Returns { key: text }
// for the ids the model returned; missing ids are left to the caller's fallback.
async function translateGroup(target, groupLabel, items, siblingPairs, instruction) {
  const location = groupLabel === 'common' ? 'shared across the app (generic UI string)' : groupLabel
  const siblings = siblingPairs.length
    ? `\nFor terminology consistency, here are already-translated strings from the same UI:\n${siblingPairs
        .map(([en, t]) => `- ${en} => ${t}`)
        .join('\n')}`
    : ''
  const system = `${baseSystemFor(target)}
UI location: ${location}${siblings}${instruction ? `\n\nAdditional instruction: ${instruction}` : ''}`

  // id-aligned (never use the key as an object key — some keys are multi-line markdown).
  // it.source is the English text to translate (= en value; differs from the key for slug keys).
  const prompt = `Translate each item below from English to ${target}.
Return one translation per id. Keep placeholders {{like_this}} and tags like <0>...</0> or <SomeButton>...</SomeButton> unchanged.
The <<< and >>> markers only delimit each source string — do NOT include them in your translation, and preserve any leading/trailing spaces inside them.
${items.map((it, i) => `[${i}]${it.hint ? ` (role: ${it.hint})` : ''} <<<${it.source}>>>`).join('\n')}`

  try {
    const { object } = await generateObject({ model: openai(MODEL), system, prompt, schema: batchSchema })
    const out = {}
    for (const { id, text } of object.translations) {
      // Defensive: strip the delimiters if the model echoed them (no whitespace
      // trim — leading/trailing spaces in keys like " for free now!" are significant).
      if (items[id]) out[items[id].key] = text.replace(/^<<</, '').replace(/>>>$/, '')
    }
    return out
  } catch (e) {
    console.warn(`Batch failed for ${target}/${groupLabel}: ${e.message}; falling back per-key`)
    return {}
  }
}

async function writeJsonAtomic(path, json) {
  const tempPath = `${path}.tmp`
  // Trailing newline matches the repo's Biome-formatted JSON (avoids spurious diffs).
  await fs.writeFile(tempPath, `${JSON.stringify(json, null, 2)}\n`)
  await fs.rename(tempPath, path)
}

// Guard: a translation must preserve exactly the same {{placeholders}} and <tags>
// (numbered <0> and named <SomeButton>) as its English source — else it dropped/
// corrupted them. Compared as a sorted multiset.
function protectedTokens(s) {
  return ((s || '').match(/{{[^}]+}}|<\/?[A-Za-z0-9]+>/g) || []).sort()
}
function tokensMatch(source, translation) {
  const a = protectedTokens(source)
  const b = protectedTokens(translation)
  return a.length === b.length && a.every((t, i) => t === b[i])
}

// All QA issues for a translation: placeholder/tag conservation + glossary policy.
function qaIssues(source, translation, locale) {
  const issues = glossaryIssues(source, translation, locale)
  if (!tokensMatch(source, translation)) issues.unshift('placeholder/tag mismatch')
  return issues
}
const qaWarnings = [] // `${locale}\t${key}\t${issues}` for translations that failed QA after fallback

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

async function translateFile(locale, instruction) {
  const targetLanguage = displayNames.of(locale) || locale
  const path = `src/renderer/i18n/locales/${locale}/translation.json`

  // Combine CLI instruction with per-locale glossary rules
  const allInstructions = [instruction, ...translateAsRules(locale)].filter(Boolean).join('\n')

  // Read and validate the file first
  const content = await fs.readFile(path, 'utf-8')
  if (!content.trim()) {
    throw new Error(`File ${path} is empty!`)
  }

  const json = JSON.parse(content)

  // en is the source: empty value means "use the key itself".
  if (locale === 'en') {
    let changed = false
    for (const [key, value] of Object.entries(json))
      if (!value) {
        json[key] = key
        changed = true
      }
    if (changed) await writeJsonAtomic(path, json)
    return
  }

  // --retranslate: re-translate every key for this locale (red-line exception).
  const retranslate = RETRANSLATE.has(locale)
  let changed = false

  for (const [groupLabel, keys] of groups) {
    const missing = retranslate ? [...keys] : keys.filter((k) => !json[k])
    if (missing.length === 0) continue
    changed = true
    const missingSet = new Set(missing)

    // L0 sibling context: same-group keys already translated in THIS locale.
    // In retranslate mode every key is missing, so this is naturally empty —
    // we never seed from the stale translations we're replacing. Pair the English
    // SOURCE (en value, not the key) with its translation for terminology context.
    const siblingPairs = keys
      .filter((k) => !missingSet.has(k) && json[k] && json[k] !== sourceText(k))
      .slice(0, 12)
      .map((k) => [sourceText(k), json[k]])

    // source = English text to translate (en value); equals the key except for slug keys.
    const items = missing.map((k) => ({ key: k, source: sourceText(k), hint: keyRoles.get(k) }))
    const result = await translateGroup(targetLanguage, groupLabel, items, siblingPairs, allInstructions)

    // Accept a batch result only if it passes QA (placeholders/tags + glossary);
    // otherwise retry that key via the per-key fallback.
    const misses = []
    for (const k of missing) {
      if (result[k] && qaIssues(sourceText(k), result[k], locale).length === 0) json[k] = result[k]
      else misses.push(k)
    }
    for (const k of misses) {
      const translated = await translateMessage(sourceText(k), targetLanguage, allInstructions)
      json[k] = translated
      const issues = qaIssues(sourceText(k), translated, locale)
      if (issues.length) qaWarnings.push(`${locale}\t${k}\t${issues.join('; ')}`)
    }
    console.debug(`${locale}/${groupLabel}: ${missing.length} translated (${misses.length} via fallback)`)
  }

  if (changed) {
    await writeJsonAtomic(path, json)
    console.debug(`Translated ${path}`)
  }
}

// Build the key→file index and screen groups once (locale-independent).
const enJson = JSON.parse(await fs.readFile('src/renderer/i18n/locales/en/translation.json', 'utf-8'))
const enKeys = Object.keys(enJson)
// The text to translate is the English VALUE. For ~99% of keys it equals the key
// (flat-key i18n); for slug keys (e.g. 'network error tips') the real message — with
// its placeholders/tags — lives in the value. Translating the key would lose them.
const sourceText = (k) => enJson[k] || k
const keyToFiles = scanKeyFileIndex('src/renderer', new Set(enKeys))
const groups = groupKeys(enKeys, keyToFiles)
const keyRoles = scanKeyRoles('src/renderer', new Set(enKeys)) // key -> UI role (placeholder/tooltip/aria/error)

if (PRINT_GROUPS) {
  const common = groups.get('common')?.length || 0
  console.log(`groups=${groups.size}  total=${enKeys.length}  common=${common} (${((common / enKeys.length) * 100).toFixed(1)}%)`)
  console.log(`keys with a UI role: ${keyRoles.size}`)
  if (RETRANSLATE.size) console.log(`retranslate locales: ${[...RETRANSLATE].join(', ')}`)
  const sizes = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [label, keys] of sizes.slice(0, 15)) console.log(`  ${keys.length}\t${label}`)
  process.exit(0)
}

try {
  await pMap(
    LOCALES,
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
  if (qaWarnings.length) {
    console.warn(`\n⚠️  ${qaWarnings.length} translation(s) failed QA — placeholder/tag or glossary (review):`)
    for (const w of qaWarnings) console.warn(`  ${w}`)
  }
} catch (error) {
  console.error('\n✗ Translation failed:', error.message)
  console.error(
    '\nTip: If files were corrupted, restore them with: git checkout src/renderer/i18n/locales/*/translation.json'
  )
  process.exit(1)
}
