import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { checkSpreadsheetArchive } from './documents'
import { decodeBase64, encodeBase64 } from './files'
import { runRequest } from './runtime'

describe('local work mode worker', () => {
  it('decodes multi-megabyte file data without recursive validation', () => {
    const bytes = new Uint8Array(8 * 1024 * 1024)
    bytes[0] = 255
    bytes[bytes.length - 1] = 128
    const decoded = decodeBase64(encodeBase64(bytes))
    expect(decoded.length).toBe(bytes.length)
    expect(decoded[0]).toBe(255)
    expect(decoded[decoded.length - 1]).toBe(128)
  })

  it.each(['AAAA=AAA', 'A===', 'AAAA====', 'AAA', 'AA A'])('rejects malformed base64 %s', (value) => {
    expect(() => decodeBase64(value)).toThrow('Invalid or oversized base64 file')
  })

  it('executes isolated async code and returns only changed workspace files', async () => {
    const result = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'files',
      files: { 'input/example.txt': { base64: encodeBase64(new TextEncoder().encode('hello')) } },
      code: `
        console.log(typeof fetch, typeof process, typeof require, typeof window, typeof __call);
        await files.writeText('output/example.txt', (await files.readText('input/example.txt')).toUpperCase());
        console.log(await files.list());
      `,
    })
    expect(result.result.error).toBeUndefined()
    expect(result.result.stdout).toContain('undefined undefined undefined undefined undefined')
    expect(Object.keys(result.result.files)).toEqual(['output/example.txt'])
    expect(new TextDecoder().decode(decodeBase64(result.result.files['output/example.txt'].base64))).toBe('HELLO')
  })

  it('reads generated presentation text through the guest docs bridge', async () => {
    const result = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'read-pptx',
      files: {},
      code: `
      await docs.writePresentation('report.pptx', {slides:[{title:'Revenue',text:'Total 42'}]});
      console.log(JSON.stringify(await docs.readPresentation('report.pptx')));
    `,
    })
    expect(result.result.error).toBeUndefined()
    expect(result.result.stdout).toContain('Revenue')
    expect(result.result.stdout).toContain('Total 42')
  })

  it.each([
    'input/a.txt',
    'artifacts/a.txt',
    '../outside.txt',
    '/output/a.txt',
    './output/a.txt',
    'output/a%20.txt',
    'output/a:b.txt',
  ])('rejects writes to %s', async (path) => {
    const result = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'paths',
      files: {},
      code: `await files.writeText(${JSON.stringify(path)}, 'bad')`,
    })
    expect(result.result.error).toBeDefined()
    expect(result.result.files).toEqual({})
  })

  it('interrupts infinite code and settles a promise that never resolves', async () => {
    const loop = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'loop',
      files: {},
      timeoutMs: 25,
      code: 'while (true) {}',
    })
    expect(loop.result.error).toMatch(/interrupted|timed out/)
    const pending = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'pending',
      files: {},
      timeoutMs: 25,
      code: 'await new Promise(() => {})',
    })
    expect(pending.result.error).toMatch(/timed out/)
  })

  it('bounds host operations while releasing settled promise handles', async () => {
    const result = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'operations',
      files: {},
      code: 'for (let i = 0; i < 10001; i++) await files.list()',
    })
    expect(result.result.error).toMatch(/10000 file\/document operations/)
  })

  it('enforces the guest memory budget', async () => {
    const result = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'memory',
      files: {},
      code: 'const bytes = new Uint8Array(64 * 1024 * 1024); console.log(bytes.length)',
    })
    expect(result.result.error).toBeDefined()
  })

  it('roundtrips a real workbook and generates an Office presentation', async () => {
    const result = await runRequest({
      skillPreferences: { spreadsheets: true, presentations: true },
      id: 'documents',
      files: {},
      code: `
        await docs.writeSpreadsheet('output/sales.xlsx', {sheets: [{name: 'Sales', rows: [['Name', 'Revenue'], ['A', 12], ['B', 30]]}]});
        const workbook = await docs.readSpreadsheet('output/sales.xlsx');
        const total = workbook.sheets[0].rows.slice(1).reduce((sum, row) => sum + row[1], 0);
        console.log(total);
        await docs.writePresentation('output/report.pptx', {title: 'Revenue', slides: [{title: 'Revenue', text: 'Total ' + total, elements: [{type: 'table', rows: [['A', '12'], ['B', '30']], x: 1, y: 3, w: 8, h: 2}]}]});
      `,
    })
    expect(result.result.error).toBeUndefined()
    expect(result.result.stdout).toBe('42\n')
    const xlsx = unzipSync(decodeBase64(result.result.files['output/sales.xlsx'].base64))
    const pptx = unzipSync(decodeBase64(result.result.files['output/report.pptx'].base64))
    expect(xlsx['xl/workbook.xml']).toBeDefined()
    expect(new TextDecoder().decode(pptx['ppt/slides/slide1.xml'])).toContain('Total 42')
  })

  it('rejects excessive actual ZIP expansion before workbook parsing', () => {
    const compressed = zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(17 * 1024 * 1024) })
    expect(() => checkSpreadsheetArchive(compressed)).toThrow(/Expanded document/)
  })
})

it.each(['readSpreadsheet', 'writeSpreadsheet', 'readPresentation', 'writePresentation'])(
  'blocks disabled document helpers: %s',
  async (method) => {
    const result = await runRequest({ id: 'disabled', files: {}, code: `await docs.${method}('out.xlsx', {})` })
    expect(result.result.error).toContain('Enable the')
    expect(result.result.files).toEqual({})
  }
)
