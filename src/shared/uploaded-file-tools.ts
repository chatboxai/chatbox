import type { JSONSchema7 } from '@ai-sdk/provider'
import { v5 as uuidv5 } from 'uuid'

export const MAX_UPLOADED_FILE_LINES = 500
export const READ_FILE_MAX_LINES = 2000
export const READ_FILE_DEFAULT_LINES = 500
export const UPLOADED_FILE_PATH_PREFIX = '/__chatbox__/files/'

export function uploadedFilePath(fileKey: string): string {
  return `${UPLOADED_FILE_PATH_PREFIX}${uuidv5(fileKey, 'bbe0a5e1-ec68-4a88-937c-ce51dd93ca80')}`
}

export function isUploadedFilePath(path: string): boolean {
  return path.startsWith(UPLOADED_FILE_PATH_PREFIX)
}

export const readFileSchema: JSONSchema7 & Record<string, unknown> = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'File path from FILE_PATH, SANDBOX_PATH or PARSED_SANDBOX_PATH; copy it exactly.',
    },
    offset: {
      type: 'integer',
      minimum: 1,
      description: 'First line to read (1-based, inclusive). Defaults to 1.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: READ_FILE_MAX_LINES,
      default: READ_FILE_DEFAULT_LINES,
      description: 'Number of lines to read. Defaults to 500; maximum 2000.',
    },
  },
  required: ['file_path'],
  additionalProperties: false,
}

export const uploadedFileSearchSchema: JSONSchema7 & Record<string, unknown> = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Read-only virtual path from FILE_PATH; copy it exactly.',
    },
    query: {
      type: 'string',
      description: 'The keyword or phrase to search for within the file.',
    },
    beforeContextLines: {
      type: 'integer',
      minimum: 0,
      description: 'Optional number of context lines to include before each match. Defaults to 0.',
    },
    afterContextLines: {
      type: 'integer',
      minimum: 0,
      description: 'Optional number of context lines to include after each match. Defaults to 0.',
    },
    maxResults: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 10,
      description: 'Optional maximum number of results to return. Defaults to 10.',
    },
  },
  required: ['file_path', 'query'],
  additionalProperties: false,
}

export function uploadedFileToolHint(fileKey: string): string {
  return `Use read_file with file_path=${JSON.stringify(uploadedFilePath(fileKey))}. For reading, offset is the first line (1-based) and limit is the number of lines.`
}
