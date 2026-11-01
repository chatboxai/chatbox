import { describe, expect, it } from 'vitest'
import {
  allSupportedExts,
  epubExts,
  getFileAcceptConfig,
  getFileAcceptString,
  getUnsupportedFileType,
  isEpubFilePath,
  isLegacyOfficeFilePath,
  isOfficeFilePath,
  isSessionAttachmentRagSupportedFilePath,
  isSupportedFile,
  isTextFilePath,
  legacyOfficeExts,
  officeExts,
  sessionAttachmentRagExts,
  textExts,
  unsupportedPatterns,
} from './file-extensions'

describe('file-extensions', () => {
  describe('exported extension arrays', () => {
    it('contains expected office, legacy office and epub extensions', () => {
      expect(officeExts).toContain('.pdf')
      expect(officeExts).toContain('.docx')
      expect(legacyOfficeExts).toEqual(['.doc', '.xls', '.ppt'])
      expect(epubExts).toEqual(['.epub'])
    })

    it('contains expected text extensions', () => {
      expect(textExts).toContain('.txt')
      expect(textExts).toContain('.md')
      expect(textExts).toContain('.json')
      expect(textExts).toContain('.tsx')
      expect(textExts).toContain('.typ')
      expect(textExts).toContain('.patch')
      expect(textExts).toContain('.diff')
      expect(textExts).toContain('.gitpatch')
      expect(textExts).toContain('.gitignore')
    })

    it('contains expanded session attachment RAG whitelist extensions', () => {
      expect(sessionAttachmentRagExts).toContain('.pdf')
      expect(sessionAttachmentRagExts).toContain('.docx')
      expect(sessionAttachmentRagExts).toContain('.pptx')
      expect(sessionAttachmentRagExts).toContain('.epub')
      expect(sessionAttachmentRagExts).toContain('.md')
      expect(sessionAttachmentRagExts).toContain('.json')
      expect(sessionAttachmentRagExts).toContain('.log')
    })

    it('does not include tabular extensions in the session attachment RAG whitelist', () => {
      for (const ext of ['.csv', '.tsv', '.xlsx', '.xls', '.ods', '.numbers']) {
        expect(sessionAttachmentRagExts).not.toContain(ext)
      }
    })

    it('does not include code extensions in the session attachment RAG whitelist', () => {
      for (const ext of ['.js', '.ts', '.tsx', '.py', '.sh', '.go', '.rs', '.java', '.css', '.sql', '.vue']) {
        expect(sessionAttachmentRagExts).not.toContain(ext)
      }
    })

    it('builds allSupportedExts as office + text + epub', () => {
      expect(allSupportedExts).toEqual([...officeExts, ...textExts, ...epubExts])
    })

    it('defines unsupported patterns for known categories', () => {
      expect(unsupportedPatterns.iwork).toContain('.pages')
      expect(unsupportedPatterns.audio).toContain('.mp3')
      expect(unsupportedPatterns.video).toContain('.mp4')
      expect(unsupportedPatterns.binary).toContain('.exe')
      expect(unsupportedPatterns.archive).toContain('.zip')
      expect(unsupportedPatterns.image).toContain('.psd')
    })
  })

  describe('isOfficeFilePath', () => {
    it('returns true for office files (case-insensitive)', () => {
      expect(isOfficeFilePath('report.pdf')).toBe(true)
      expect(isOfficeFilePath('/tmp/slides.PPTX')).toBe(true)
    })

    it('returns false for non-office files and no extension', () => {
      expect(isOfficeFilePath('notes.txt')).toBe(false)
      expect(isOfficeFilePath('README')).toBe(false)
      expect(isOfficeFilePath('')).toBe(false)
    })
  })

  describe('isLegacyOfficeFilePath', () => {
    it('returns true for legacy office files (case-insensitive)', () => {
      expect(isLegacyOfficeFilePath('old.doc')).toBe(true)
      expect(isLegacyOfficeFilePath('sheet.XLS')).toBe(true)
      expect(isLegacyOfficeFilePath('deck.PpT')).toBe(true)
    })

    it('returns false for modern office files and missing extension', () => {
      expect(isLegacyOfficeFilePath('new.docx')).toBe(false)
      expect(isLegacyOfficeFilePath('old')).toBe(false)
      expect(isLegacyOfficeFilePath('')).toBe(false)
    })
  })

  describe('isTextFilePath', () => {
    it('returns true for text/code/config files (case-insensitive)', () => {
      expect(isTextFilePath('notes.txt')).toBe(true)
      expect(isTextFilePath('README.MD')).toBe(true)
      expect(isTextFilePath('src/app.TSX')).toBe(true)
      expect(isTextFilePath('paper.typ')).toBe(true)
      expect(isTextFilePath('fix.patch')).toBe(true)
      expect(isTextFilePath('.gitignore')).toBe(true)
    })

    it('returns false for unsupported and extensionless files', () => {
      expect(isTextFilePath('video.mp4')).toBe(false)
      expect(isTextFilePath('LICENSE')).toBe(false)
      expect(isTextFilePath('')).toBe(false)
    })
  })

  describe('isSessionAttachmentRagSupportedFilePath', () => {
    it('excludes tabular files from session attachment RAG', () => {
      expect(isSessionAttachmentRagSupportedFilePath('budget.xlsx')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('legacy.xls')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('data.csv')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('table.tsv')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('sheet.numbers')).toBe(false)
    })

    it('allows non-tabular documents and text files', () => {
      expect(isSessionAttachmentRagSupportedFilePath('report.pdf')).toBe(true)
      expect(isSessionAttachmentRagSupportedFilePath('slides.pptx')).toBe(true)
      expect(isSessionAttachmentRagSupportedFilePath('outline.odt')).toBe(true)
      expect(isSessionAttachmentRagSupportedFilePath('deck.odp')).toBe(true)
      expect(isSessionAttachmentRagSupportedFilePath('notes.md')).toBe(true)
      expect(isSessionAttachmentRagSupportedFilePath('data.json')).toBe(true)
      expect(isSessionAttachmentRagSupportedFilePath('debug.log')).toBe(true)
      expect(isSessionAttachmentRagSupportedFilePath('book.epub')).toBe(true)
    })

    it('excludes code files from session attachment RAG', () => {
      expect(isSessionAttachmentRagSupportedFilePath('src/app.tsx')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('script.py')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('main.go')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('style.css')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('query.sql')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('component.vue')).toBe(false)
    })

    it('excludes unsupported or extensionless files from session attachment RAG', () => {
      expect(isSessionAttachmentRagSupportedFilePath('archive.zip')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('README')).toBe(false)
      expect(isSessionAttachmentRagSupportedFilePath('')).toBe(false)
    })
  })

  describe('isEpubFilePath', () => {
    it('returns true only for epub files (case-insensitive)', () => {
      expect(isEpubFilePath('book.epub')).toBe(true)
      expect(isEpubFilePath('BOOK.EPUB')).toBe(true)
    })

    it('returns false for non-epub files and no extension', () => {
      expect(isEpubFilePath('book.pdf')).toBe(false)
      expect(isEpubFilePath('book')).toBe(false)
      expect(isEpubFilePath('')).toBe(false)
    })
  })

  describe('isSupportedFile', () => {
    it('returns true for supported office/text/epub files', () => {
      expect(isSupportedFile('report.pdf')).toBe(true)
      expect(isSupportedFile('notes.md')).toBe(true)
      expect(isSupportedFile('novel.epub')).toBe(true)
      expect(isSupportedFile('paper.typ')).toBe(true)
      expect(isSupportedFile('fix.patch')).toBe(true)
      expect(isSupportedFile('.gitignore')).toBe(true)
    })

    it('returns true for numbers files', () => {
      expect(isSupportedFile('budget.numbers')).toBe(true)
      expect(isSupportedFile('BUDGET.NUMBERS')).toBe(true)
    })

    it('returns false for unsupported or extensionless names', () => {
      expect(isSupportedFile('song.mp3')).toBe(false)
      expect(isSupportedFile('archive.zip')).toBe(false)
      expect(isSupportedFile('README')).toBe(false)
      expect(isSupportedFile('')).toBe(false)
    })
  })

  describe('getUnsupportedFileType', () => {
    it('returns category for unsupported file extensions', () => {
      expect(getUnsupportedFileType('slides.pages')).toBe('iwork')
      expect(getUnsupportedFileType('track.MP3')).toBe('audio')
      expect(getUnsupportedFileType('movie.mp4')).toBe('video')
      expect(getUnsupportedFileType('installer.exe')).toBe('binary')
      expect(getUnsupportedFileType('bundle.tar.gz')).toBe('archive')
      expect(getUnsupportedFileType('design.psd')).toBe('image')
    })

    it('returns null for supported, unknown, extensionless, or empty names', () => {
      expect(getUnsupportedFileType('doc.pdf')).toBeNull()
      expect(getUnsupportedFileType('something.customext')).toBeNull()
      expect(getUnsupportedFileType('README')).toBeNull()
      expect(getUnsupportedFileType('')).toBeNull()
    })
  })

  describe('getFileAcceptString', () => {
    it('contains all supported extensions plus .numbers', () => {
      const accept = getFileAcceptString()

      expect(accept).toContain('.pdf')
      expect(accept).toContain('.txt')
      expect(accept).toContain('.epub')
      expect(accept).toContain('.numbers')

      const parts = accept.split(',')
      expect(parts).toEqual([...allSupportedExts, '.numbers'])
    })
  })

  describe('getFileAcceptConfig', () => {
    it('returns expected mime groups and extensions', () => {
      const config = getFileAcceptConfig()

      expect(config['image/*']).toEqual(['.jpg', '.jpeg', '.png'])
      expect(config['text/plain']).toContain('.txt')
      expect(config['text/plain']).toContain('.typ')
      expect(config['text/plain']).toContain('.patch')
      expect(config['text/plain']).toContain('.gitignore')
      expect(config['application/json']).toEqual(['.json'])
      expect(config['application/pdf']).toEqual(['.pdf'])
      expect(config['application/vnd.apple.numbers']).toEqual(['.numbers'])
      expect(config['application/epub+zip']).toEqual(['.epub'])
    })
  })
})
