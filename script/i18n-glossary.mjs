/**
 * i18n 术语策略 + 校验，全项目唯一真相源。
 *   - keepVerbatim：各语言都保留英文、不翻译的词（品牌/产品/技术锚点词）。
 *   - translateAs： 分语言的强制译法（如 "Quota" => "点数"）。
 *
 * 纯 stdlib，方便 `--selftest` 在未装依赖时也能跑。
 * CLI：--fill-en / --list-empty / --check / --selftest（见文件末尾各段）。
 */
import fs from 'node:fs'

export const glossary = {
  // 注入翻译提示词。品牌词模型基本 100% 会保留；真正靠 verbatim 护栏强制的是
  // 技术锚点词（意译会丢失可识别度）。
  keepVerbatim: [
    // 品牌 / 产品 / 通用
    'Chatbox',
    'AI',
    'MCP',
    'Deep Link',
    'ID',
    // 技术锚点词（每种语言都保留英文）
    'API',
    'URL',
    'OCR',
    'LaTeX',
    'Token',
    'Embedding',
    'Rerank',
    'Copilot',
  ],

  // 分语言强制术语。既注入提示词、也由护栏强制。'Agent' 只列出会本地化它的语言；
  // 把 "Agent" 当本地词的语言（de/fr/sv/nb-NO）不列，让模型自然保留英文。
  // License 与 License Key 视为同一概念，都映射到 许可证/許可證（不带 密钥/金鑰）；
  // 'License Key' 条目排在前面，是为了让模型把整个短语收掉，否则 License 单独翻会留下 'key'。
  translateAs: {
    ar: { Agent: 'الوكيل' },
    es: { Agent: 'Agente' },
    'it-IT': { Agent: 'Agente' },
    ja: { Agent: 'エージェント' },
    ko: { Agent: '에이전트' },
    'pt-PT': { Agent: 'Agente' },
    ru: { Agent: 'агент' },
    'zh-Hans': { Quota: '点数', Agent: '智能体', 'License Key': '许可证', License: '许可证' },
    'zh-Hant': { Quota: '點數', Agent: '智能體', 'License Key': '許可證', License: '許可證' },
  },
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 词干匹配：只要前置词边界，所以 'Token' 也能匹配 'Tokens'/'Token数'、'Rerank' 匹配
// 'Reranking'——容忍各语言的复数/后缀。
const stemRe = (t) => new RegExp(`\\b${escapeRe(t)}`)

// 只对「长且无歧义的单 token」强制逐字保留；短词（AI/ID/MCP）或多词（Deep Link）会误报。
const verbatimGuardTerms = glossary.keepVerbatim.filter((t) => /^[A-Za-z][A-Za-z0-9]{4,}$/.test(t))

/** 提示词里的 `Do not translate these words: ...` 行（Path A 用）。 */
export function doNotTranslateLine() {
  return `Do not translate these words: ${glossary.keepVerbatim.map((t) => `"${t}"`).join(', ')}.`
}

/** 某语言的强制术语指令列表（Path A 用）。 */
export function translateAsRules(locale) {
  const map = glossary.translateAs[locale] || {}
  return Object.entries(map).map(([term, forced]) => `Translate "${term}" as "${forced}"`)
}

/**
 * 一条译文的 glossary 违规（空数组 = 合规）：
 * - 源文里出现强制术语，但译文没用规定的译法
 * - 源文里出现可护栏的 verbatim 词，但译文把它丢了
 */
export function glossaryIssues(source, translation, locale) {
  const issues = []
  for (const [term, forced] of Object.entries(glossary.translateAs[locale] || {})) {
    // 两边都大小写不敏感：源文可能是 'license'/'License'，拉丁强制词也可能在句中小写
    // （'agentmodus'）。CJK 无大小写，toLowerCase 是空操作。
    const inSource = new RegExp(`\\b${escapeRe(term)}\\b`, 'i').test(source)
    if (inSource && !translation.toLowerCase().includes(forced.toLowerCase()))
      issues.push(`missing forced term ${term}=>${forced}`)
  }
  for (const t of verbatimGuardTerms) {
    if (stemRe(t).test(source) && !stemRe(t).test(translation)) issues.push(`dropped verbatim term ${t}`)
  }
  return issues
}

/** 译文必须原样保留的 {{占位符}} 与 <标签>，排序后作为多重集比较。 */
function protectedTokens(s) {
  return ((s || '').match(/{{[^}]+}}|<\/?[A-Za-z0-9]+>/g) || []).sort()
}

/** 一条译文的全部违规（空数组 = 合规）：占位符/标签守恒 + glossary 策略。 */
function entryIssues(source, translation, locale) {
  const issues = glossaryIssues(source, translation, locale)
  const a = protectedTokens(source)
  const b = protectedTokens(translation)
  if (a.length !== b.length || !a.every((t, i) => t === b[i])) issues.unshift('placeholder/tag mismatch')
  return issues
}

// --- CLI 公共工具 ---
const DIR = 'packages/chatbox-i18n/src/locales'
const readLocale = (locale) => JSON.parse(fs.readFileSync(`${DIR}/${locale}/translation.json`, 'utf8'))
// flag 后面的位置参数即指定语言；没指定则取除 en 外全部语言。
function localeArgs(flag) {
  const named = process.argv.slice(process.argv.indexOf(flag) + 1).filter((a) => !a.startsWith('-'))
  if (named.length) return named
  return fs.readdirSync(DIR).filter((d) => d !== 'en' && fs.existsSync(`${DIR}/${d}/translation.json`))
}

// --- 补 en：`node script/i18n-glossary.mjs --fill-en` ---
// en 的「译文」就是英文原文 = key 本身。i18next 抽取后新 key 在所有语言都是空值，
// 这步把 en 的空值填成 key（否则英文 UI 会渲染空白）。
if (process.argv.includes('--fill-en')) {
  const file = `${DIR}/en/translation.json`
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  let filled = 0
  for (const k of Object.keys(json))
    if (!json[k]) {
      json[k] = k
      filled++
    }
  if (filled) fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`en: filled ${filled} key(s)`)
  process.exit(0)
}

// --- 列待翻：`node script/i18n-glossary.mjs --list-empty [locale ...]` ---
// 对每个空值（未翻译）打印 `locale<TAB>key`。不指定语言则查全部非 en 语言。
if (process.argv.includes('--list-empty')) {
  for (const locale of localeArgs('--list-empty')) {
    const json = readLocale(locale)
    for (const k of Object.keys(json)) if (!json[k]) console.log(`${locale}\t${k}`)
  }
  process.exit(0)
}

// --- 校验闸：`node script/i18n-glossary.mjs --check [locale ...]` ---
// 拿每条译文对照英文源 + glossary 校验；有违规则退出码 1（供 skill / CI 当门禁）。
if (process.argv.includes('--check')) {
  const en = readLocale('en')
  const source = (k) => en[k] || k
  let total = 0
  for (const locale of localeArgs('--check')) {
    const json = readLocale(locale)
    let empty = 0
    const problems = []
    for (const k of Object.keys(json)) {
      if (!json[k]) {
        empty++
        continue
      }
      const issues = entryIssues(source(k), json[k], locale)
      if (issues.length) problems.push({ k, issues })
    }
    total += problems.length
    const emptyNote = empty ? `, ${empty} empty` : ''
    if (problems.length) {
      console.log(`✗ ${locale}: ${problems.length} violation(s)${emptyNote}`)
      for (const { k, issues } of problems) console.log(`    ${JSON.stringify(k.slice(0, 60))}: ${issues.join('; ')}`)
    } else {
      console.log(`✓ ${locale}: clean${emptyNote}`)
    }
  }
  process.exit(total ? 1 : 0)
}

// --- 自检：`node script/i18n-glossary.mjs --selftest`（改完本文件后跑一下） ---
if (process.argv.includes('--selftest')) {
  const assert = await import('node:assert/strict').then((m) => m.default)

  assert.ok(doNotTranslateLine().includes('"Chatbox"'), 'verbatim line lists Chatbox')
  assert.ok(translateAsRules('zh-Hans').includes('Translate "Quota" as "点数"'), 'zh-Hans Quota rule')
  assert.deepEqual(translateAsRules('en'), [], 'no rules for en')

  // 强制术语：zh-Hans 的 Quota 必须用 点数
  assert.ok(glossaryIssues('You have Quota left', '你还有额度', 'zh-Hans').some((s) => s.includes('Quota')), 'forced miss')
  assert.equal(glossaryIssues('You have Quota left', '你还有点数', 'zh-Hans').length, 0, 'forced ok')

  // verbatim：Chatbox 必须保留；短词 AI 不应被护栏
  assert.ok(glossaryIssues('Open Chatbox now', '立即打开聊天框', 'ja').some((s) => s.includes('Chatbox')), 'verbatim drop')
  assert.equal(glossaryIssues('Open Chatbox now', '立即打开 Chatbox', 'ja').length, 0, 'verbatim ok')
  assert.equal(glossaryIssues('Use AI here', '在这里使用人工智能', 'ja').length, 0, 'short term not guarded')

  // 词干匹配容忍复数/后缀：源 'Tokens' 译文用 'Token' 也算保留
  assert.equal(glossaryIssues('Max Output Tokens', '最大出力Token数', 'ja').length, 0, 'plural->singular ok')
  assert.equal(glossaryIssues('Estimated Token Usage', 'Estimation des Tokens', 'fr').length, 0, 'singular->plural ok')
  assert.ok(glossaryIssues('Default Rerank Model', '默认重排模型', 'zh-Hans').some((s) => s.includes('Rerank')), 'rerank dropped')

  // 强制术语大小写不敏感（罗曼语可能把 'Agente' 小写）
  assert.equal(glossaryIssues('Agent Mode', 'usa modo agente', 'es').length, 0, 'forced term case-insensitive')

  // 多词 + 小写源：'license key' 必须收成 许可证
  assert.ok(
    glossaryIssues('check your license key', '检查您的 license key', 'zh-Hans').some((s) => s.includes('License Key')),
    'license key forced (lowercase source)'
  )
  assert.equal(glossaryIssues('check your license key', '检查您的许可证', 'zh-Hans').length, 0, 'license key ok')
  assert.ok(glossaryIssues('Agent Mode', '使用代理模式', 'zh-Hant').some((s) => s.includes('Agent')), 'zh-Hant Agent forced')
  // 把 Agent 当本地词的语言不强制
  assert.equal(glossaryIssues('Agent Mode', 'Agenten-Modus', 'de').length, 0, 'de Agent not forced')

  // entryIssues = 占位符/标签守恒 + glossary
  assert.equal(entryIssues('Hi {{name}}', '你好 {{name}}', 'zh-Hans').length, 0, 'entry ok')
  assert.ok(entryIssues('Hi {{name}}', '你好', 'zh-Hans').some((s) => s.includes('placeholder')), 'entry dropped placeholder')
  assert.ok(entryIssues('Use <0>License</0>', '使用 <0>授权</0>', 'zh-Hans').some((s) => s.includes('License')), 'entry glossary')

  console.log('i18n-glossary selftest OK')
  process.exit(0)
}
