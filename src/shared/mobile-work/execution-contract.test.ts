import { describe, expect, it } from 'vitest'
import { explainQuickJSError, QUICKJS_EXAMPLE } from './execution-contract'
import { encodeBase64, decodeBase64 } from './worker/files'
import { runRequest } from './worker/runtime'

describe('QuickJS execution guidance', () => {
  it('executes the model-facing example in the actual sandbox', async () => {
    const { result } = await runRequest({
      id: 'example',
      files: { 'input/data.json': { base64: encodeBase64(new TextEncoder().encode('{"total":42}')) } },
      code: QUICKJS_EXAMPLE.slice('Example:\n'.length),
    })
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Saved output/result.json')
    expect(new TextDecoder().decode(decodeBase64(result.files['output/result.json'].base64))).toBe('{"total":42}')
  })

  it.each([
    ['require("fs")', 'files.readText'],
    ['process.cwd()', 'workspace-relative'],
    ['Buffer.from("hello")', 'files.readBase64'],
    ['console.log(__dirname)', 'workspace-relative'],
    ['module.exports = {}', 'QuickJS runtime'],
    ['fetch("https://example.com")', 'web tools'],
    ['document.createElement("div")', 'create_download'],
  ])('explains unsupported API in %s', async (code, replacement) => {
    const { result } = await runRequest({ id: 'unsupported', files: {}, code })
    expect(result.error).toBeTruthy()
    expect(explainQuickJSError(result.error)).toContain(result.error)
    expect(explainQuickJSError(result.error)).toContain(replacement)
  })

  it('preserves unrelated errors and successful results', () => {
    for (const error of [undefined, 'Execution timed out', "'data' is not defined", 'Invalid path: require']) {
      expect(explainQuickJSError(error)).toBe(error)
    }
  })
})
