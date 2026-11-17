import type { ImageGeneration, ImageGenerationPage } from '../types'

export interface ImageGenerationStoragePort {
  initialize(): Promise<void>
  create(record: ImageGeneration): Promise<void>
  update(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | null>
  getById(id: string): Promise<ImageGeneration | null>
  delete(id: string): Promise<void>
  getPage(cursor: number, limit?: number): Promise<ImageGenerationPage>
  getTotal(): Promise<number>
}
