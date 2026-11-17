import { Unzip, UnzipInflate } from 'fflate'
import { DOMParser } from 'linkedom/worker'

/** Bound all expanded entries, including files the caller does not need. */
export function readOfficeArchive(bytes: Uint8Array, select: (path: string) => boolean): Map<string, string> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Expected an Open XML document archive')
  let total = 0
  let count = 0
  let failure: Error | undefined
  const entries = new Map<string, string>()
  const unzip = new Unzip((file) => {
    if (++count > 2048) throw new Error('Document has too many ZIP entries')
    let size = 0
    const selected = select(file.name)
    const chunks: Uint8Array[] = []
    file.ondata = (error, data, final) => {
      if (error) {
        failure = error
        return
      }
      size += data.length
      total += data.length
      if (size > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) {
        failure = new Error('Expanded document exceeds memory limits')
        throw failure
      }
      if (selected) {
        chunks.push(data)
        if (final) {
          if (entries.has(file.name)) throw new Error('Duplicate document entry')
          const content = new Uint8Array(size)
          let offset = 0
          for (const chunk of chunks) {
            content.set(chunk, offset)
            offset += chunk.length
          }
          entries.set(file.name, new TextDecoder('utf-8', { fatal: true }).decode(content))
        }
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length)
    if (failure) throw failure
  }
  if (count === 0) throw new Error('Empty document archive')
  return entries
}

function xml(value: string | undefined) {
  if (!value || /<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('Missing or unsupported document XML')
  return new DOMParser().parseFromString(value, 'text/xml')
}

type XmlElement = ReturnType<typeof xml>['documentElement']

function localName(element: XmlElement): string {
  return element.tagName.split(':').pop() ?? ''
}
function elements(root: ReturnType<typeof xml> | XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = []
  const pending = Array.from(root.children).reverse()
  while (pending.length) {
    const element = pending.pop()!
    if (localName(element) === name) result.push(element)
    pending.push(...Array.from(element.children).reverse())
  }
  return result
}

function paragraphs(value: string | undefined, truncate = false, maximum = 100_000): string {
  const document = xml(value)
  const parts: string[] = []
  let length = 0
  for (const paragraph of elements(document, 'p')) {
    const runs: string[] = []
    const visit = (element: XmlElement) => {
      switch (localName(element)) {
        case 't':
          runs.push(element.textContent ?? '')
          return
        case 'tab':
          runs.push('\t')
          return
        case 'br':
        case 'cr':
          runs.push('\n')
          return
      }
      for (const child of Array.from(element.children)) visit(child)
    }
    visit(paragraph)
    const text = runs.join('')
    length += text.length + 1
    if (length > maximum) {
      if (!truncate) throw new Error('Document text exceeds 100000 characters')
      parts.push(text)
      return parts.join('\n').slice(0, maximum)
    }
    parts.push(text)
  }
  return parts.join('\n')
}

export function readWordText(bytes: Uint8Array, truncate = false) {
  const entries = readOfficeArchive(bytes, (path) => path === 'word/document.xml')
  return { text: paragraphs(entries.get('word/document.xml'), truncate, truncate ? 100_001 : 100_000) }
}

export function readPresentationText(bytes: Uint8Array, truncate = false) {
  const entries = readOfficeArchive(
    bytes,
    (path) =>
      path === 'ppt/presentation.xml' ||
      path === 'ppt/_rels/presentation.xml.rels' ||
      /^ppt\/slides\/[^/]+\.xml$/.test(path)
  )
  const presentation = xml(entries.get('ppt/presentation.xml'))
  const relationships = xml(entries.get('ppt/_rels/presentation.xml.rels'))
  const targets = new Map<string, string>()
  for (const relationship of elements(relationships, 'Relationship')) {
    if (relationship.getAttribute('TargetMode') === 'External') continue
    const target = relationship.getAttribute('Target') ?? ''
    if (!/^(?:\/ppt\/)?slides\/[^/]+\.xml$/.test(target)) continue
    targets.set(relationship.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : `ppt/${target}`)
  }
  const ids = elements(presentation, 'sldId')
  if (ids.length > 50) throw new Error('Presentation exceeds 50 slides')
  let length = 0
  const slides = ids.map((id, index) => {
    const relationshipId = id
      .getAttributeNames()
      .find((name: string) => name.includes(':') && name.split(':').pop() === 'id')
    const path = targets.get(id.getAttribute(relationshipId ?? '') ?? '')
    if (!path) throw new Error('Missing local slide relationship')
    const text = paragraphs(entries.get(path), truncate, truncate ? Math.max(0, 100_001 - length) : 100_000)
    length += text.length
    if (!truncate && length > 100_000) throw new Error('Presentation text exceeds 100000 characters')
    return { slide: index + 1, text }
  })
  return { slides }
}
