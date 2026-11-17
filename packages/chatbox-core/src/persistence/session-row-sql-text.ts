const SLICE_CHARACTERS = 16 * 1024

/** Slices are transport units; each message has one persistent JSON value. */
export function* sqlTextSlices(value: string): Generator<string> {
  for (let offset = 0; offset < value.length; ) {
    let end = Math.min(value.length, offset + SLICE_CHARACTERS)
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--
    yield value.slice(offset, end)
    offset = end
  }
}
