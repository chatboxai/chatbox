import { readSpreadsheet } from './spreadsheet-reader'
export { checkSpreadsheetArchive } from './spreadsheet-reader'
import ExcelJS from 'exceljs'
import { readWordText, readPresentationText } from './office-text'
import PptxGenJS from 'pptxgenjs'
import { encodeBase64, type WorkerFiles } from './files'

const MAX_CELLS = 100_000
const MAX_SLIDES = 50
const MAX_TEXT = 100_000

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}

function text(value: unknown, fallback = ''): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error('Invalid or oversized text')
  return value
}

function items(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`Expected an array with at most ${maximum} items`)
  return value
}

function number(value: unknown, fallback: number, maximum = 100): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)
    throw new Error('Invalid numeric option')
  return value
}

function color(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[0-9a-f]{6}$/i.test(value)) throw new Error('Colors must be six-digit hex values')
  return value
}

export function createDocumentTools(files: WorkerFiles) {
  return {
    async readDocument(path: unknown) {
      return readWordText(files.read(path))
    },
    async readPresentation(path: unknown) {
      return readPresentationText(files.read(path))
    },
    async readSpreadsheet(path: unknown) {
      return readSpreadsheet(files.read(path))
    },

    async writeSpreadsheet(path: unknown, input: unknown) {
      const specification = object(input)
      const workbook = new ExcelJS.Workbook()
      let cellCount = 0
      for (const sheetInput of items(specification.sheets, 32)) {
        const sheet = object(sheetInput)
        const worksheet = workbook.addWorksheet(text(sheet.name))
        for (const rowInput of items(sheet.rows, MAX_CELLS)) {
          const row = items(rowInput, 1024)
          cellCount += Math.max(row.length, 1)
          if (cellCount > MAX_CELLS) throw new Error('Workbook exceeds 100000 cells')
          worksheet.addRow(
            row.map((cell) => {
              if (cell === null || typeof cell === 'boolean') return cell
              if (typeof cell === 'number' && Number.isFinite(cell)) return cell
              return text(cell)
            })
          )
        }
        worksheet.getRow(1).font = { bold: true }
      }
      const bytes = await workbook.xlsx.writeBuffer()
      files.write(path, new Uint8Array(bytes))
      return { path, bytes: bytes.byteLength }
    },

    async writePresentation(path: unknown, input: unknown) {
      const specification = object(input)
      const presentation = new PptxGenJS()
      presentation.layout = 'LAYOUT_WIDE'
      presentation.title = text(specification.title, 'Presentation')
      presentation.author = 'Chatbox'
      for (const slideInput of items(specification.slides, MAX_SLIDES)) {
        const specification = object(slideInput)
        const slide = presentation.addSlide()
        slide.background = { color: color(specification.background, 'FFFFFF') }
        if (specification.title !== undefined)
          slide.addText(text(specification.title), { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 28, bold: true })
        if (specification.text !== undefined)
          slide.addText(text(specification.text), { x: 0.5, y: 1.1, w: 12.3, h: 5.8, fontSize: 18, valign: 'top' })
        for (const elementInput of items(specification.elements ?? [], 100)) {
          const element = object(elementInput)
          const position = {
            x: number(element.x, 0.5, 13.34),
            y: number(element.y, 1.2, 7.5),
            w: number(element.w, 6, 13.34),
            h: number(element.h, 1, 7.5),
          }
          switch (element.type) {
            case 'text':
              slide.addText(text(element.text), {
                ...position,
                fontSize: number(element.fontSize, 18, 96),
                bold: element.bold === true,
                color: color(element.color, '222222'),
                valign: 'top',
              })
              break
            case 'image': {
              const bytes = files.read(element.path)
              const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
              const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8
              if (!png && !jpeg) throw new Error('Presentation images must be local PNG or JPEG files')
              slide.addImage({ ...position, data: `image/${png ? 'png' : 'jpeg'};base64,${encodeBase64(bytes)}` })
              break
            }
            case 'table': {
              const rows = items(element.rows, 200).map((row) => items(row, 20).map((cell) => ({ text: text(cell) })))
              slide.addTable(rows, {
                ...position,
                fontSize: number(element.fontSize, 14, 96),
                border: { pt: 1, color: 'DDDDDD' },
              })
              break
            }
            case 'shape': {
              const shape = element.shape === 'ellipse' ? presentation.ShapeType.ellipse : presentation.ShapeType.rect
              slide.addShape(shape, {
                ...position,
                fill: { color: color(element.color, 'EEEEEE') },
                line: { color: color(element.color, 'EEEEEE') },
              })
              break
            }
            default:
              throw new Error('Unsupported presentation element type')
          }
        }
      }
      const output = await presentation.write({ outputType: 'uint8array' })
      if (!(output instanceof Uint8Array)) throw new Error('Unexpected presentation output')
      files.write(path, output)
      return { path, bytes: output.length }
    },
  }
}
