import { parseHTML } from 'linkedom/worker'
import {
  base64ToText,
  MAX_WORKSPACE_BYTES,
  validateWorkspaceFiles,
  type WorkspaceFiles,
  workspacePath,
} from './workspace-path'

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  json: 'application/json',
}

function problem(message: string): never {
  throw new Error(`Static site: ${message}`)
}

/** Bundles classic-script static sites. Node projects, ES modules and runtime fetches require a build step. */
export function bundleStaticSite(entryPath: string, files: WorkspaceFiles): string {
  validateWorkspaceFiles(files)
  const entry = workspacePath(entryPath)
  let expandedBytes = 0
  const account = (value: string) => {
    expandedBytes += new TextEncoder().encode(value).byteLength
    if (expandedBytes > MAX_WORKSPACE_BYTES) problem('expanded assets exceed 20 MB')
    return value
  }
  const file = (path: string) => {
    if (!Object.hasOwn(files, path)) problem(`missing local asset ${path}`)
    return files[path]
  }
  const text = (path: string) => account(base64ToText(file(path).base64))

  const resolve = (reference: string, owner: string): { path: string; fragment: string } => {
    const value = reference.trim()
    if (!value || /[\\\u0000-\u001f]/.test(value)) problem(`invalid asset reference in ${owner}`)
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) problem(`external asset ${value} must be copied into the workspace`)
    const hash = value.indexOf('#')
    const fragment = hash < 0 ? '' : value.slice(hash)
    const withoutHash = hash < 0 ? value : value.slice(0, hash)
    const pathname = withoutHash.split('?')[0]
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return problem(`invalid URL encoding in ${owner}`)
    }
    if (/[\\:%\u0000-\u001f]/.test(decoded)) problem(`invalid local asset path in ${owner}`)
    const parts = decoded.startsWith('/') ? [] : owner.split('/').slice(0, -1)
    for (const part of decoded.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!parts.length) problem(`asset escapes the workspace: ${reference}`)
        parts.pop()
      } else parts.push(part)
    }
    return { path: workspacePath(parts.join('/')), fragment }
  }

  const resource = (reference: string, owner: string) => {
    if (reference.startsWith('#')) return reference
    if (/^data:/i.test(reference)) return reference
    const { path, fragment } = resolve(reference, owner)
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const mime = MIME_TYPES[extension] ?? 'application/octet-stream'
    return account(`data:${mime};base64,${file(path).base64}${fragment}`)
  }

  const stylesheet = (source: string, owner: string, ancestors: string[]): string => {
    let result = ''
    let index = 0
    const quoted = (start: number): number => {
      const quote = source[start]
      let end = start + 1
      for (; end < source.length; end++) {
        if (source[end] === '\\') {
          end++
          continue
        }
        if (source[end] === quote) return end + 1
      }
      return problem(`unterminated CSS string in ${owner}`)
    }
    const readUrl = (start: number): { value: string; end: number } => {
      let cursor = start
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++
      let value: string
      if (source[cursor] === '"' || source[cursor] === "'") {
        const end = quoted(cursor)
        value = source.slice(cursor + 1, end - 1)
        cursor = end
      } else {
        const end = source.indexOf(')', cursor)
        if (end < 0) problem(`unterminated CSS url in ${owner}`)
        value = source.slice(cursor, end).trim()
        cursor = end
      }
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++
      if (source[cursor] !== ')') problem(`unsupported CSS url syntax in ${owner}`)
      if (value.includes('\\')) problem(`CSS-escaped URLs must be written as plain URLs in ${owner}`)
      return { value, end: cursor + 1 }
    }
    while (index < source.length) {
      if (source.startsWith('/*', index)) {
        const end = source.indexOf('*/', index + 2)
        if (end < 0) problem(`unterminated CSS comment in ${owner}`)
        result += source.slice(index, end + 2)
        index = end + 2
        continue
      }
      if (source[index] === '"' || source[index] === "'") {
        const end = quoted(index)
        result += source.slice(index, end)
        index = end
        continue
      }
      const importMatch = source[index] === '@' ? /^@import\s+/i.exec(source.slice(index)) : null
      if (importMatch) {
        let cursor = index + importMatch[0].length
        let reference: string
        if (source[cursor] === '"' || source[cursor] === "'") {
          const end = quoted(cursor)
          reference = source.slice(cursor + 1, end - 1)
          cursor = end
        } else {
          const url = /^url\s*\(/i.exec(source.slice(cursor))
          if (!url) problem(`unsupported CSS import syntax in ${owner}`)
          const parsed = readUrl(cursor + url[0].length)
          reference = parsed.value
          cursor = parsed.end
        }
        const end = source.indexOf(';', cursor)
        if (end < 0) problem(`unterminated CSS import in ${owner}`)
        const media = source.slice(cursor, end).trim()
        if (/\b(?:layer|supports)\b/i.test(media) || /[{}@]/.test(media))
          problem(`CSS import modifiers require a build step in ${owner}`)
        const { path } = resolve(reference, owner)
        if (ancestors.includes(path)) problem(`circular stylesheet import ${path}`)
        const imported = stylesheet(text(path), path, [...ancestors, path])
        result += media ? `@media ${media}{\n${imported}\n}` : imported
        index = end + 1
        continue
      }
      const urlMatch = /[uU]/.test(source[index]) ? /^url\s*\(/i.exec(source.slice(index)) : null
      if (urlMatch && (index === 0 || !/[\w-]/.test(source[index - 1]))) {
        const parsed = readUrl(index + urlMatch[0].length)
        result += `url("${resource(parsed.value, owner).replaceAll('"', '%22')}")`
        index = parsed.end
        continue
      }
      result += source[index++]
    }
    return result
  }

  const document = parseHTML(text(entry)).document
  if (document.querySelector('base')) problem('base elements require a build step')
  for (const script of Array.from(document.querySelectorAll('script'))) {
    const type = script.getAttribute('type')?.trim().toLowerCase()
    if (type === 'module' || type === 'importmap') problem('ES modules require a build step into classic scripts')
    const src = script.getAttribute('src')
    const content = src ? text(resolve(src, entry).path) : (script.textContent ?? '')
    if (
      (!type || /(?:java|ecma)script/.test(type)) &&
      /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\(/.test(content)
    ) {
      problem('dynamic imports require a build step into classic scripts')
    }
    if (src) {
      // A data URL preserves async/defer timing; inline classic scripts would run early in the head.
      const { path } = resolve(src, entry)
      script.setAttribute('src', account(`data:application/javascript;base64,${file(path).base64}`))
      script.removeAttribute('integrity')
      script.removeAttribute('crossorigin')
    }
    if (!src) script.textContent = content.replace(/<\/script/gi, '<\\/script')
  }
  for (const link of Array.from(document.querySelectorAll('link[href]'))) {
    const href = link.getAttribute('href') ?? ''
    const rel = link.getAttribute('rel')?.toLowerCase().split(/\s+/) ?? []
    if (rel.includes('stylesheet')) {
      const { path } = resolve(href, entry)
      const style = document.createElement('style')
      const media = link.getAttribute('media')
      if (media) style.setAttribute('media', media)
      style.textContent = stylesheet(text(path), path, [path]).replace(/<\/style/gi, '<\\/style')
      link.replaceWith(style)
    } else if (rel.includes('icon')) link.setAttribute('href', resource(href, entry))
    else problem(`link relation ${rel.join(' ')} requires a build step`)
  }
  for (const style of Array.from(document.querySelectorAll('style'))) {
    // Styles inserted from linked files already contain resolved data URLs.
    style.textContent = stylesheet(style.textContent ?? '', entry, [entry]).replace(/<\/style/gi, '<\\/style')
  }
  for (const element of Array.from(document.querySelectorAll('[style]'))) {
    element.setAttribute('style', stylesheet(element.getAttribute('style') ?? '', entry, [entry]))
  }
  for (const element of Array.from(document.querySelectorAll('[src], [poster]'))) {
    if (element.tagName === 'SCRIPT') continue
    if (element.tagName === 'IFRAME') problem('embedded frames require a build step')
    for (const attribute of ['src', 'poster']) {
      const value = element.getAttribute(attribute)
      if (value) element.setAttribute(attribute, resource(value, entry))
    }
  }
  if (document.querySelector('[srcset]')) problem('responsive srcset images require a build step into src images')
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (href && !href.startsWith('#') && !/^(?:https?:|mailto:|tel:)/i.test(href)) {
      problem(`local page navigation ${href} requires a single-page build`)
    }
  }
  const output = document.toString()
  if (new TextEncoder().encode(output).byteLength > MAX_WORKSPACE_BYTES) problem('packaged HTML exceeds 20 MB')
  return output
}
