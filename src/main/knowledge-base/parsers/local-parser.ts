import fs from 'node:fs'
import type { ModelMessage } from 'ai'
import { getLangSmithErrorMessage } from '../../../shared/utils/langsmith_adapter'
import {
  isEpubFilePath,
  isLegacyOfficeFilePath,
  isOfficeFilePath,
  isTextFilePath,
} from '../../../shared/file-extensions'
import type { DocumentParserType } from '../../../shared/types/settings'
import { parseFile } from '../../file-parser'
import { langsmith } from '../../adapters/langsmith'
import { getVisionProvider } from '../model-providers'
import type { DocumentParser, ParserFileMeta } from './types'

/**
 * Local document parser
 * Uses built-in libraries for document parsing
 * Supports: Office files, images (via vision model), EPUB, text files
 */
export class LocalParser implements DocumentParser {
  readonly type: DocumentParserType = 'local'

  constructor(private kbId?: number) {}

  async parse(filePath: string, meta: ParserFileMeta): Promise<string> {
    if (isLegacyOfficeFilePath(filePath)) {
      throw new Error(
        'Legacy Office formats (.doc/.xls/.ppt) are not supported by local parser. Please convert to .docx/.xlsx/.pptx or switch document parser to Chatbox AI.'
      )
    }

    if (isOfficeFilePath(filePath)) {
      return await parseFile(filePath)
    }

    if (meta.mimeType.startsWith('image/')) {
      return await this.parseImage(filePath, meta)
    }

    if (isEpubFilePath(filePath)) {
      return await parseFile(filePath)
    }

    if (isTextFilePath(filePath)) {
      return await parseFile(filePath)
    }

    throw new Error(`Unsupported file type: ${meta.mimeType}`)
  }

  /**
   * Parse image file using vision model (OCR)
   */
  private async parseImage(filePath: string, meta: ParserFileMeta): Promise<string> {
    if (!this.kbId) {
      throw new Error('Knowledge base ID required for image parsing')
    }

    const vision = await getVisionProvider(this.kbId)
    if (!vision) {
      throw new Error('Vision model not configured for this knowledge base')
    }

    const { model: visionModel } = vision

    // Read image as base64
    const imageBase64 = fs.readFileSync(filePath, { encoding: 'base64' })
    const dataUrl = `data:${meta.mimeType};base64,${imageBase64}`

    // Assemble chat message with image
    const msg: ModelMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'OCR the following image into Markdown. Do not surround your output with triple backticks.',
        },
        { type: 'image', image: dataUrl, mediaType: meta.mimeType },
      ],
    }

    const traceRun = await langsmith.startRun({
      name: 'chatbox.knowledge_base.local_parser.image_ocr',
      runType: 'chain',
      inputs: {
        kbId: this.kbId ?? null,
        mimeType: meta.mimeType,
        filename: meta.filename,
        modelId: visionModel.modelId,
      },
      tags: ['chatbox', 'main', 'knowledge-base', 'ocr'],
    })

    const chatResult = await visionModel
      .chat([msg], {
        traceContext: {
          name: 'chatbox.knowledge_base.local_parser.image_ocr.llm',
          parentRunId: traceRun.runId,
          metadata: {
            kbId: this.kbId ?? null,
            mimeType: meta.mimeType,
          },
          tags: ['knowledge-base', 'ocr'],
        },
      })
      .catch(async (error) => {
        await traceRun.end({
          error: getLangSmithErrorMessage(error),
        })
        throw error
      })
    const text = chatResult.contentParts
      .filter((p) => p.type === 'text')
      .map((p: { type: 'text'; text: string }) => p.text)
      .join('')
    await traceRun.end({
      outputs: {
        textPreview: text.slice(0, 240),
      },
    })

    return text
  }
}
