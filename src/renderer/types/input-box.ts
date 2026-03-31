import type { Message } from '@shared/types'

export type PreprocessStatus = 'processing' | 'completed' | 'error' | undefined

export type PreprocessedFile = {
  file: File
  content: string
  storageKey: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  error?: string
}

export type PreprocessedLink = {
  url: string
  title: string
  content: string
  storageKey: string
  tokenCountMap?: Record<string, number>
  lineCount?: number
  byteLength?: number
  error?: string
}

export type PreConstructedMessageState = {
  text: string
  pictureKeys: string[]
  attachments: File[]
  links: Array<{ url: string }>
  preprocessedFiles: PreprocessedFile[]
  preprocessedLinks: PreprocessedLink[]
  preprocessingStatus: {
    files: Record<string, PreprocessStatus>
    links: Record<string, PreprocessStatus>
  }
  preprocessingPromises: {
    files: Map<string, Promise<unknown>>
    links: Map<string, Promise<unknown>>
  }
  message?: Message
}
