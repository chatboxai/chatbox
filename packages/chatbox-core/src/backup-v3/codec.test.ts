import { describe, expect, it, vi } from 'vitest'
import { defaultBackupCodec } from './codec'
import { trackedNodeCodec } from './codec.test-helpers'
import { countChunks, decodeJson, decodeJsonLines, singleChunk } from './streams'

const encode = (value: string) => new TextEncoder().encode(value)
async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of stream) values.push(value)
  return values
}

describe('backup byte streams', () => {
  it.each([defaultBackupCodec, trackedNodeCodec().codec])(
    'preserves strict UTF-8, view offsets, non-BMP characters, and control-file BOM semantics',
    (codec) => {
      const bytes = encode('prefix\uFEFF{"text":"汉字🌍\\n"}suffix')
      expect(decodeJson(bytes.subarray(6, bytes.length - 6), codec)).toEqual({ text: '汉字🌍\n' })
      expect(codec.decodeUtf8(encode('\uFEFF\uFEFFx'))).toBe('\uFEFFx')
      expect(codec.decodeUtf8(encode('a\uFEFFb'))).toBe('a\uFEFFb')
      for (const invalid of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0x8c], [0xf4, 0x90, 0x80, 0x80]]) {
        expect(() => codec.decodeUtf8(Uint8Array.from(invalid))).toThrow()
      }
    }
  )

  it('passes complete JSONL views to the codec across split Unicode and rejects BOM before decoding', async () => {
    const probe = trackedNodeCodec()
    const bytes = encode('{"text":"🌍汉字"}\n{"n":2}\n')
    async function* chunks() {
      for (const byte of bytes) yield Uint8Array.from([255, byte, 255]).subarray(1, 2)
    }
    expect((await drain(decodeJsonLines(chunks(), 1024, undefined, probe.codec))).map((line) => line.value)).toEqual([
      { text: '🌍汉字' },
      { n: 2 },
    ])
    expect(probe.decodes()).toBe(2)
    await expect(
      drain(decodeJsonLines(singleChunk(encode('\uFEFF{}\n')), 1024, undefined, probe.codec))
    ).rejects.toThrow('byte-order')
    expect(probe.decodes()).toBe(2)
    await expect(
      drain(decodeJsonLines(singleChunk(Uint8Array.from([34, 255, 34, 10])), 1024, undefined, probe.codec))
    ).rejects.toThrow()
  })

  it('counts streamed slices without buffering and completes only after consumption', async () => {
    const slice = encode('prefix🌍abc\nsuffix').subarray(6, 14)
    const complete = vi.fn()
    const iterator = countChunks(singleChunk(slice), 'data', 1024, complete)
    expect((await iterator.next()).value).toBe(slice)
    expect(complete).not.toHaveBeenCalled()
    expect((await iterator.next()).done).toBe(true)
    expect(complete).toHaveBeenCalledWith(slice.length)
  })

  it.each(['return', 'cancel', 'input-error', 'limit'] as const)('closes the source after %s', async (exit) => {
    const controller = new AbortController()
    const complete = vi.fn()
    const sourceClosed = vi.fn()
    async function* input() {
      try {
        yield encode('abc')
        if (exit === 'input-error') throw new Error('input')
        yield encode('def')
      } finally {
        sourceClosed()
      }
    }
    const iterator = countChunks(input(), 'data', exit === 'limit' ? 3 : 100, complete, controller.signal)
    await iterator.next()
    if (exit === 'return') await iterator.return(undefined)
    else {
      if (exit === 'cancel') controller.abort(new Error('cancel'))
      await expect(drain(iterator)).rejects.toThrow()
    }
    expect(sourceClosed).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })
})
