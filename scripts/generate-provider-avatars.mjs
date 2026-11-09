#!/usr/bin/env node
// Exports the round provider avatars of the installed @lobehub/icons package into a static table shared by the
// renderer and the React Native app: `node scripts/generate-provider-avatars.mjs`.
//
// Each icon's own `Avatar` component is rendered to static markup (with its UI-library wrappers stubbed out) and
// turned into a self-contained 24×24 SVG: the background circle plus the inner icon scaled by AVATAR_ICON_MULTIPLE.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire, register } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = path.join(ROOT, 'packages/chatbox-core/src/session/provider-avatars.generated.ts')
const require = createRequire(path.join(ROOT, 'package.json'))
const ICONS_DIR = path.dirname(require.resolve('@lobehub/icons/package.json'))
const { version: ICONS_VERSION } = JSON.parse(fs.readFileSync(path.join(ICONS_DIR, 'package.json'), 'utf8'))

/** Provider id → @lobehub/icons icon name. */
const PROVIDER_ICONS = {
  openai: 'OpenAI',
  'openai-responses': 'OpenAI',
  azure: 'Azure',
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  'lm-studio': 'LmStudio',
  groq: 'Groq',
  xAI: 'XAI',
  perplexity: 'Perplexity',
  'mistral-ai': 'Mistral',
  siliconflow: 'SiliconCloud',
  qwen: 'Qwen',
  'qwen-portal': 'Qwen',
  'chatglm-6b': 'Zhipu',
  'zhipu-glm-coding-plan': 'Zhipu',
  moonshot: 'Moonshot',
  'moonshot-cn': 'Moonshot',
  minimax: 'Minimax',
  'minimax-cn': 'Minimax',
  'tencent-hunyuan': 'Hunyuan',
  volcengine: 'Volcengine',
  longcat: 'LongCat',
  'xiaomi-mimo': 'XiaomiMiMo',
  bedrock: 'Bedrock',
  'github-copilot': 'GithubCopilot',
  'vercel-ai-gateway': 'Vercel',
  'opencode-go': 'OpenCode',
  'opencode-zen': 'OpenCode',
  'fish-audio': 'FishAudio',
}

// The package ships extensionless ESM imports and wraps avatars in @lobehub/ui / antd-style; resolve the former and
// replace the latter with minimal stubs that keep the rendered style.
const STUB = `const R = globalThis.__providerAvatarReact
export const Center = ({ style, children }) => R.createElement('div', { style }, children)
export const useThemeMode = () => ({ isDarkMode: false })
export default {}`
const HOOKS = `
const STUB_URL = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(STUB)}`)}
export async function resolve(specifier, context, next) {
  if (specifier === '@lobehub/ui' || specifier === 'antd-style') return { url: STUB_URL, shortCircuit: true }
  try {
    return await next(specifier, context)
  } catch (error) {
    if (!specifier.startsWith('.')) throw error
    for (const suffix of ['.js', '/index.js']) {
      try { return await next(specifier + suffix, context) } catch {}
    }
    throw error
  }
}`
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`)

const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
globalThis.__providerAvatarReact = React

/** Converts a CSS `linear-gradient(...)` into SVG gradient coordinates for a square box. */
function toSvgGradient(css, id) {
  const args = css
    .slice(css.indexOf('(') + 1, css.lastIndexOf(')'))
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
  let angle = 180
  if (/^-?[\d.]+deg$/.test(args[0])) angle = Number.parseFloat(args.shift())
  else if (args[0].startsWith('to ')) {
    const sides = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 }
    angle = sides[args.shift()] ?? 180
  }
  const rad = (angle * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const half = (Math.abs(dx) + Math.abs(dy)) / 2
  const fmt = (n) => String(Math.round(n * 1000) / 1000)
  const stops = args.map((color, index) => {
    const [value, offset] = color.split(/\s+(?=[\d.]+%$)/)
    const position = offset ?? `${Math.round((index / (args.length - 1)) * 100)}%`
    return `<stop offset="${position}" stop-color="${value}"/>`
  })
  return `<linearGradient id="${id}" x1="${fmt(0.5 - dx * half)}" y1="${fmt(0.5 - dy * half)}" x2="${fmt(0.5 + dx * half)}" y2="${fmt(0.5 + dy * half)}">${stops.join('')}</linearGradient>`
}

function readStyle(markup) {
  const style = markup.match(/^<div style="([^"]*)"/)?.[1] ?? ''
  const entries = style
    .replaceAll('&quot;', '"')
    .split(/;(?![^(]*\))/)
    .map((rule) => rule.split(/:(.*)/s).map((part) => part.trim()))
  return Object.fromEntries(entries.filter(([key]) => key))
}

async function exportAvatar(iconName) {
  const { default: Avatar } = await import(path.join(ICONS_DIR, 'es', iconName, 'components/Avatar.js'))
  const style = await import(path.join(ICONS_DIR, 'es', iconName, 'style.js'))
  const markup = renderToStaticMarkup(React.createElement(Avatar, { size: 24 }))
  const { background: bg, color: fg } = readStyle(markup)
  const scale = style.AVATAR_ICON_MULTIPLE
  const icon = markup.match(/<svg[\s\S]*<\/svg>/)?.[0]
  if (!bg || !fg || typeof scale !== 'number' || !icon) throw new Error(`Unexpected avatar markup for ${iconName}`)

  const iconBody = icon
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(/<title>[^<]*<\/title>/, '')
    .replaceAll('currentColor', fg)
  const iconFill = icon.match(/^<svg[^>]*\sfill="([^"]*)"/)?.[1]
  const iconFillRule = icon.match(/^<svg[^>]*\sfill-rule="([^"]*)"/)?.[1]
  // Margins on the inner icon (e.g. MiniMax's optical `marginLeft`) shift it inside the flex-centered avatar by half
  // their difference; the scale then applies around the shifted center.
  const iconStyle = readStyle(`<div style="${icon.match(/^<svg[^>]*\sstyle="([^"]*)"/)?.[1] ?? ''}"`)
  const margin = (side) => Number.parseFloat(iconStyle[`margin-${side}`] ?? '0')
  const dx = (margin('left') - margin('right')) / 2
  const dy = (margin('top') - margin('bottom')) / 2
  const groupAttrs = [
    `transform="translate(${12 + dx} ${12 + dy}) scale(${scale}) translate(-12 -12)"`,
    iconFill ? `fill="${iconFill === 'currentColor' ? fg : iconFill}"` : '',
    iconFillRule ? `fill-rule="${iconFillRule}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const isGradient = bg.startsWith('linear-gradient')
  const gradientId = `${iconName}-avatar-bg`
  const defs = isGradient ? `<defs>${toSvgGradient(bg, gradientId)}</defs>` : ''
  const circleFill = isGradient ? `url(#${gradientId})` : bg
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${defs}<circle cx="12" cy="12" r="12" fill="${circleFill}"/><g ${groupAttrs}>${iconBody}</g></svg>`
  return { bg, fg, scale, svg }
}

const icons = {}
for (const iconName of [...new Set(Object.values(PROVIDER_ICONS))].sort()) {
  icons[iconName] = await exportAvatar(iconName)
}

const output = `// Generated by scripts/generate-provider-avatars.mjs from @lobehub/icons ${ICONS_VERSION}. Do not edit by hand.
//
// The SVG artwork below is derived from @lobehub/icons (https://github.com/lobehub/lobe-icons), MIT License:
//
// Copyright (c) 2023 LobeHub
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// Brand logos remain trademarks of their respective owners.

export interface ProviderAvatarIcon {
  /** Avatar background: a CSS color or \`linear-gradient(...)\`. */
  bg: string
  /** Inner icon color. */
  fg: string
  /** Inner icon size relative to the avatar. */
  scale: number
  /** Complete 24×24 round avatar: background circle plus the scaled inner icon. */
  svg: string
}

export const PROVIDER_AVATAR_ICON_NAMES: Record<string, string> = ${JSON.stringify(PROVIDER_ICONS, null, 2)}

export const PROVIDER_AVATAR_ICONS: Record<string, ProviderAvatarIcon> = ${JSON.stringify(icons, null, 2)}
`
fs.writeFileSync(OUTPUT, output)
execFileSync(path.join(ROOT, 'node_modules/.bin/biome'), ['format', '--write', OUTPUT], { stdio: 'ignore' })
console.log(`Wrote ${Object.keys(icons).length} provider avatars to ${path.relative(ROOT, OUTPUT)}`)
