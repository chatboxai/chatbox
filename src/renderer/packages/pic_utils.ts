/**
 * 获取图片base64，在必要时缩小到主流模型支持的尺寸，同时支持将 svg、gif 等文件转成 png 格式
 * @param file 图片文件
 * @returns 图片base64
 */
export const MODEL_IMAGE_MAX_DIMENSION = 1568

export function calculateImageResizeSize(
  originalWidth: number,
  originalHeight: number
): {
  width: number
  height: number
} {
  if (
    !Number.isFinite(originalWidth) ||
    !Number.isFinite(originalHeight) ||
    originalWidth <= 0 ||
    originalHeight <= 0
  ) {
    throw new Error('Image has invalid dimensions')
  }

  let scale = Math.min(1, MODEL_IMAGE_MAX_DIMENSION / originalWidth, MODEL_IMAGE_MAX_DIMENSION / originalHeight)
  let width = Math.max(1, Math.floor(originalWidth * scale))
  let height = Math.max(1, Math.floor(originalHeight * scale))

  // OpenAI high-resolution inputs should keep their short side at or below 768px.
  const maxShortDimension = 768
  const shortDimension = Math.min(width, height)
  if (shortDimension > maxShortDimension) {
    scale = maxShortDimension / shortDimension
    width = Math.max(1, Math.floor(width * scale))
    height = Math.max(1, Math.floor(height * scale))
  }
  return { width, height }
}

export interface ImageResizeOptions {
  outputType?: 'image/jpeg' | 'image/png' | 'image/webp'
  quality?: number
}

export async function getImageBase64AndResize(file: File, options: ImageResizeOptions = {}) {
  if (!file.type.startsWith('image/')) {
    throw new Error('file is not an image')
  }
  // Claude: To improve time-to-first-token, we recommend resizing images to no more than 1.15 megapixels (and within 1568 pixels in both dimensions).
  // https://docs.anthropic.com/en/docs/build-with-claude/vision
  return new Promise<string>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('cannot get canvas context'))
      return
    }
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      // 释放 object URL
      URL.revokeObjectURL(objectUrl)
      let resizeSize: { width: number; height: number }
      try {
        resizeSize = calculateImageResizeSize(img.width, img.height)
      } catch (error) {
        reject(error)
        return
      }
      // 设置canvas尺寸为缩放后的尺寸
      canvas.width = resizeSize.width
      canvas.height = resizeSize.height
      // 绘制缩放后的图片
      ctx.drawImage(img, 0, 0, resizeSize.width, resizeSize.height)
      // Callers may request a bounded lossy format; user-upload behavior keeps the legacy default.
      const outputType = options.outputType ?? (file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png')
      const quality = options.quality ?? (outputType === 'image/jpeg' ? 0.9 : 1)
      const base64 = canvas.toDataURL(outputType, quality)
      resolve(base64)
    }
    img.onerror = (error) => {
      // 发生错误时也要释放 object URL
      URL.revokeObjectURL(objectUrl)
      reject(error)
    }
    img.src = objectUrl
  })
}

export function svgCodeToBase64(svgCode: string) {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgCode)))
}

export interface SvgRasterizeOptions {
  /** Maximum width or height of the allocated output canvas. */
  maxOutputDimension?: number
  /** Restrict SVG content to elements and references that cannot load nested resources. */
  strictResourceIsolation?: boolean
}

export function calculateSvgRasterSize(
  sourceWidth: number,
  sourceHeight: number,
  options: SvgRasterizeOptions = {}
): { width: number; height: number } {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('SVG has invalid dimensions')
  }
  const maxOutputDimension = options.maxOutputDimension ?? Number.POSITIVE_INFINITY
  if (Number.isNaN(maxOutputDimension) || maxOutputDimension <= 0) {
    throw new Error('SVG raster limit must be positive')
  }
  const scale = Math.min(2, maxOutputDimension / sourceWidth, maxOutputDimension / sourceHeight)
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  }
}

function parseSvgDataUrl(svgDataUrl: string): Document {
  const separatorIndex = svgDataUrl.indexOf(',')
  if (separatorIndex < 0 || !svgDataUrl.slice(0, separatorIndex).endsWith(';base64')) {
    throw new Error('SVG must be a base64 data URL')
  }
  const svgCode = atob(svgDataUrl.slice(separatorIndex + 1))
  if (/<!doctype|<\?xml-stylesheet/i.test(svgCode)) {
    throw new Error('SVG external document declarations are not supported')
  }
  const svgDoc = new DOMParser().parseFromString(svgCode, 'image/svg+xml')
  if (svgDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('SVG is not valid XML')
  }
  return svgDoc
}

const SAFE_SVG_ELEMENT_NAMES = new Set([
  'a',
  'circle',
  'clippath',
  'defs',
  'desc',
  'ellipse',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
  'filter',
  'g',
  'line',
  'lineargradient',
  'marker',
  'mask',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialgradient',
  'rect',
  'stop',
  'style',
  'svg',
  'switch',
  'symbol',
  'text',
  'textpath',
  'title',
  'tspan',
  'use',
  'view',
])
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
const RESOURCE_ATTRIBUTE_NAMES = new Set(['background', 'data', 'href', 'poster', 'src'])

function hasUnsafeSvgResourceValue(value: string): boolean {
  if (/\\|\/\*|@import|(?:data|blob|file|https?|javascript):|(?:image|image-set|cross-fade)\s*\(/i.test(value)) {
    return true
  }
  const withoutLocalReferences = value.replace(/url\s*\(\s*(['"]?)#[^\s)'"\\]+\1\s*\)/gi, '')
  return /url\s*\(/i.test(withoutLocalReferences)
}

/** Enforce a strict subset that cannot load nested documents, rasters, or stylesheets. */
export function svgHasUnsafeResources(svgDoc: Pick<Document, 'getElementsByTagName'>): boolean {
  for (const element of Array.from(svgDoc.getElementsByTagName('*'))) {
    const namespace = element.namespaceURI
    const elementName = element.localName.toLowerCase()
    if (
      (namespace !== null && namespace !== '' && namespace !== SVG_NAMESPACE) ||
      !SAFE_SVG_ELEMENT_NAMES.has(elementName)
    ) {
      return true
    }
    if (elementName === 'style' && hasUnsafeSvgResourceValue(element.textContent ?? '')) return true

    for (const attribute of Array.from(element.attributes)) {
      if (
        attribute.namespaceURI === XMLNS_NAMESPACE ||
        attribute.name === 'xmlns' ||
        attribute.name.startsWith('xmlns:')
      ) {
        continue
      }
      const attributeName = attribute.localName.toLowerCase()
      const value = attribute.value.trim()
      if (attributeName.startsWith('on') || hasUnsafeSvgResourceValue(value)) return true
      if (RESOURCE_ATTRIBUTE_NAMES.has(attributeName) && !/^#[^\s]+$/.test(value)) return true
    }
  }
  return false
}

export async function svgToPngBase64(svgBase64: string, options: SvgRasterizeOptions = {}): Promise<string> {
  const svgDoc = parseSvgDataUrl(svgBase64)
  if (options.strictResourceIsolation && svgHasUnsafeResources(svgDoc)) {
    throw new Error('SVG contains resources that are not supported for safe rasterization')
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let width = img.width
      let height = img.height
      try {
        const svgElement = svgDoc.documentElement
        const viewBox = svgElement.getAttribute('viewBox')
        if (viewBox) {
          const items = viewBox.split(/[\s,]+/)
          if (items.length === 4) {
            const [, , viewBoxWidth, viewBoxHeight] = items.map((item) => parseFloat(item))
            if (viewBoxWidth && viewBoxHeight) {
              // 检查NaN
              width = Math.max(viewBoxWidth, img.width)
              height = Math.max(viewBoxHeight, img.height)
              // console.log('viewBoxWidth', viewBoxWidth, 'viewBoxHeight', viewBoxHeight)
            }
          }
        }
      } catch (e) {
        console.error(e)
      }
      // console.log('img.width', img.width, 'img.height', img.height)
      // console.log('width', width, 'height', height)

      let rasterSize: { width: number; height: number }
      try {
        rasterSize = calculateSvgRasterSize(width, height, options)
      } catch (error) {
        reject(error)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = rasterSize.width
      canvas.height = rasterSize.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('cannot get canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0, rasterSize.width, rasterSize.height)
      try {
        const pngBase64 = canvas.toDataURL('image/png', 1.0) // 使用最高质量设置
        resolve(pngBase64)
      } catch (error) {
        reject(error)
      }
    }
    img.onerror = (error) => {
      reject(error)
    }
    img.src = svgBase64
  })
}
