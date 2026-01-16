import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import * as base64 from '@/packages/base64'
import type { Exporter } from './interfaces'

export default class MobileExporter implements Exporter {
  constructor() {}

  private async shareFile(filename: string, blob: Blob, mimeType: string) {
    try {
      // Convert blob to base64
      const reader = new FileReader()
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string
          // Remove data URL prefix (e.g., "data:image/png;base64,")
          const base64String = result.split(',')[1] || result
          resolve(base64String)
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      // Write file to cache directory
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      })

      // Share the file using native share sheet
      await Share.share({
        title: filename,
        text: `Export: ${filename}`,
        url: result.uri,
        dialogTitle: 'Export File',
      })

      // Clean up cache file after a delay to allow share to complete
      setTimeout(async () => {
        try {
          await Filesystem.deleteFile({
            path: filename,
            directory: Directory.Cache,
          })
        } catch (e) {
          console.warn('Failed to clean up cache file:', e)
        }
      }, 5000)
    } catch (error) {
      console.error('Failed to share file:', error)
      throw new Error(`Failed to export file: ${error}`)
    }
  }

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    await this.shareFile(filename, blob, blob.type || 'application/octet-stream')
  }

  async exportTextFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain' })
    await this.shareFile(filename, blob, 'text/plain')
  }

  async exportImageFile(basename: string, base64Data: string) {
    // Parse base64 data
    let { type, data } = base64.parseImage(base64Data)
    if (type === '') {
      type = 'image/png'
      data = base64Data
    }
    const ext = (type.split('/')[1] || 'png').split('+')[0] // Handle svg+xml case
    const filename = basename + '.' + ext

    try {
      // Write file to cache directory
      const result = await Filesystem.writeFile({
        path: filename,
        data: data,
        directory: Directory.Cache,
      })

      // Share the file using native share sheet
      await Share.share({
        title: filename,
        text: `Export: ${filename}`,
        url: result.uri,
        dialogTitle: 'Export Image',
      })

      // Clean up cache file after a delay to allow share to complete
      setTimeout(async () => {
        try {
          await Filesystem.deleteFile({
            path: filename,
            directory: Directory.Cache,
          })
        } catch (e) {
          console.warn('Failed to clean up cache file:', e)
        }
      }, 5000)
    } catch (error) {
      console.error('Failed to export image:', error)
      throw new Error(`Failed to export image: ${error}`)
    }
  }

  async exportByUrl(filename: string, url: string) {
    try {
      // Fetch the file from URL
      const response = await fetch(url)
      const blob = await response.blob()
      await this.shareFile(filename, blob, blob.type || 'application/octet-stream')
    } catch (error) {
      console.error('Failed to export from URL:', error)
      throw new Error(`Failed to export from URL: ${error}`)
    }
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
