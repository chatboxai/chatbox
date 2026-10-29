/** Canonical JSON hashing with bounded string escaping and UTF-16 hash semantics. */
export function sessionContentHash(value: unknown): string {
  let length = 0
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  const append = (text: string) => {
    length += text.length
    let firstHash = first
    let secondHash = second
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      firstHash = Math.imul(firstHash ^ code, 0x01000193) >>> 0
      firstHash ^= firstHash >>> 13
      secondHash = Math.imul(secondHash ^ code, 0x01000193) >>> 0
      secondHash ^= secondHash >>> 13
    }
    first = firstHash
    second = secondHash
  }
  const string = (text: string) => {
    append('"')
    for (let offset = 0; offset < text.length; ) {
      let end = Math.min(offset + 16 * 1024, text.length)
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--
      append(JSON.stringify(text.slice(offset, end)).slice(1, -1))
      offset = end
    }
    append('"')
  }
  const ancestors = new Set<object>()
  const prepare = (input: unknown, key: string): unknown => {
    if (input && (typeof input === 'object' || typeof input === 'bigint')) {
      const toJSON = (input as { toJSON?: unknown }).toJSON
      if (typeof toJSON === 'function') return toJSON.call(input, key)
    }
    return input
  }
  const omitted = (input: unknown) => input === undefined || typeof input === 'function' || typeof input === 'symbol'
  const visit = (input: unknown) => {
    if (typeof input === 'string') return string(input)
    if (!input || typeof input !== 'object') {
      append(JSON.stringify(input) ?? String(input))
      return
    }
    if (ancestors.has(input)) throw new TypeError('Cyclic session content')
    ancestors.add(input)
    if (Array.isArray(input)) {
      append('[')
      const size = input.length
      for (let i = 0; i < size; i++) {
        if (i) append(',')
        const item = prepare(input[i], String(i))
        visit(omitted(item) ? null : item)
      }
      append(']')
    } else {
      // Object enumeration places integer keys first even after locale sorting.
      const sorted = Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))
      append('{')
      let count = 0
      for (const key of Object.keys(sorted)) {
        const item = prepare(sorted[key], key)
        if (omitted(item)) continue
        if (count++) append(',')
        string(key)
        append(':')
        visit(item)
      }
      append('}')
    }
    ancestors.delete(input)
  }
  const root = prepare(value, '')
  if (omitted(root)) append(String(value))
  else visit(root)
  return `${length.toString(36)}:${first.toString(16).padStart(8, '0')}:${second.toString(16).padStart(8, '0')}`
}
