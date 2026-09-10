export {
  getImageModelRatioOptions,
  resolveImageModelSelection,
  resolveImageRatioSelection,
} from '@chatbox/core/application/image-generation'

export interface ImageModelSelection {
  provider: string
  model: string
}
