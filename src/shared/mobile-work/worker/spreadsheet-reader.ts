import ExcelJS from 'exceljs'
import { readOfficeArchive } from './office-text'
const MAX_CELLS = 100_000

/** Count actual decompressed bytes before a document parser builds its object graph. */
export function checkSpreadsheetArchive(bytes: Uint8Array): void {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Only .xlsx workbooks are supported')
  readOfficeArchive(bytes, () => false)
}

export async function readSpreadsheet(bytes: Uint8Array) {
  checkSpreadsheetArchive(bytes)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(new Uint8Array(bytes).buffer)
  let cellCount = 0
  const sheets = workbook.worksheets.map((sheet) => {
    if (sheet.rowCount > MAX_CELLS || sheet.columnCount > 1024) throw new Error('Workbook dimensions exceed limits')
    const rows: unknown[][] = []
    sheet.eachRow({ includeEmpty: true }, (row) => {
      cellCount += Math.max(row.cellCount, 1)
      if (cellCount > MAX_CELLS) throw new Error('Workbook exceeds 100000 cells')
      const cells: unknown[] = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        const value = cell.value
        if (value instanceof Date) cells.push(value.toISOString())
        else if (value === null || typeof value !== 'object') cells.push(value)
        else cells.push(cell.text)
      })
      rows.push(cells)
    })
    return { name: sheet.name, rows }
  })
  return { sheets }
}
