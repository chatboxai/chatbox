import { Exporter } from './interfaces'
import * as base64 from '@/packages/base64'

export default class WebExporter implements Exporter {
  constructor() {}

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    var eleLink = document.createElement('a')
    eleLink.download = filename
    eleLink.style.display = 'none'
    eleLink.href = URL.createObjectURL(blob)
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
  }

  async exportTextFile(filename: string, content: string) {
    var eleLink = document.createElement('a')
    eleLink.download = filename
    eleLink.style.display = 'none'
    var blob = new Blob([content])
    eleLink.href = URL.createObjectURL(blob)
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
  }

  async exportImageFile(basename: string, base64Data: string) {
    // 解析 base64 数据
    let { type, data } = base64.parseImage(base64Data)
    if (type === '') {
      type = 'image/png'
      data = base64Data
    }
    const ext = (type.split('/')[1] || 'png').split('+')[0] // 处理 svg+xml 的情况
    const filename = basename + '.' + ext

    const raw = window.atob(data)
    const rawLength = raw.length
    const uInt8Array = new Uint8Array(rawLength)
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i)
    }
    const blob = new Blob([uInt8Array], { type })
    var eleLink = document.createElement('a')
    eleLink.download = filename
    eleLink.style.display = 'none'
    eleLink.href = URL.createObjectURL(blob)
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
  }

  async exportByUrl(filename: string, url: string) {
    var eleLink = document.createElement('a')
    eleLink.style.display = 'none'
    eleLink.download = filename
    eleLink.href = url
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
  }

  async exportStreamingJson(filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) {
    try {
      let content = ''
      const generator = dataCallback()

      for await (const chunk of generator) {
        content += chunk
      }

      await this.exportTextFile(filename, content)
    } catch (error) {
      console.error('Failed to export streaming JSON:', error)
      throw error
    }
  }
}
