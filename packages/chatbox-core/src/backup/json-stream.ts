const encoder = new TextEncoder()
function* entries(value: object): Generator<[string, unknown]> {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) yield [String(index), value[index]]
  } else {
    for (const key in value) if (Object.hasOwn(value, key)) yield [key, (value as Record<string, unknown>)[key]]
  }
}

/** Serializes a materialized legacy value without creating a second full JSON string. */
export function* jsonUtf8Chunks(value: unknown): Generator<Uint8Array> {
  const ancestors = new Set<object>()
  function* string(value: string): Generator<Uint8Array> {
    yield encoder.encode('"')
    for (let offset = 0; offset < value.length; ) {
      let end = Math.min(offset + 16 * 1024, value.length)
      if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--
      yield encoder.encode(JSON.stringify(value.slice(offset, end)).slice(1, -1))
      offset = end
    }
    yield encoder.encode('"')
  }
  function* visit(input: unknown, depth: number): Generator<Uint8Array> {
    if (depth > 128) throw new Error('Backup JSON nesting exceeds budget')
    if (typeof input === 'string') {
      yield* string(input)
      return
    }
    if (input === null || typeof input !== 'object') {
      const scalar = JSON.stringify(input)
      if (scalar === undefined) throw new Error('Unsupported backup JSON value')
      yield encoder.encode(scalar)
      return
    }
    if (input instanceof Date) {
      yield* visit(input.toJSON(), depth + 1)
      return
    }
    if (ancestors.has(input)) throw new Error('Cyclic backup JSON value')
    ancestors.add(input)
    const array = Array.isArray(input)
    yield encoder.encode(array ? '[' : '{')
    let first = true
    for (const [key, item] of entries(input)) {
      const omitted = item === undefined || typeof item === 'function' || typeof item === 'symbol'
      if (!array && omitted) continue
      if (!first) yield encoder.encode(',')
      first = false
      if (!array) {
        yield* string(String(key))
        yield encoder.encode(':')
      }
      yield* visit(omitted ? null : item, depth + 1)
    }
    yield encoder.encode(array ? ']' : '}')
    ancestors.delete(input)
  }
  yield* visit(value, 0)
}

/** Conservative bound: long strings are classified before encoding their body. */
export function fitsInlineBackupJson(value: unknown, budget: number): boolean {
  let remaining = budget
  const seen = new Set<object>()
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 128) return false
    remaining -= typeof item === 'string' ? item.length * 6 + 2 : 16
    if (remaining < 0) return false
    if (item && typeof item === 'object') {
      if (seen.has(item)) return false
      seen.add(item)
      for (const [key, child] of entries(item)) {
        if (!visit(key, depth + 1) || !visit(child, depth + 1)) return false
      }
      seen.delete(item)
    }
    return true
  }
  return visit(value, 0)
}

export function* jsonUtf8Blocks(value: unknown): Generator<Uint8Array> {
  let block = new Uint8Array(128 * 1024)
  let used = 0
  for (const part of jsonUtf8Chunks(value)) {
    for (let offset = 0; offset < part.length; ) {
      const count = Math.min(part.length - offset, block.length - used)
      block.set(part.subarray(offset, offset + count), used)
      offset += count
      used += count
      if (used === block.length) {
        yield block
        block = new Uint8Array(128 * 1024)
        used = 0
      }
    }
  }
  if (used) yield block.subarray(0, used)
}
