import { Directory, Encoding, Filesystem, type WriteFileOptions, type WriteFileResult } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Toast } from '@capacitor/toast'
import i18n from '@/i18n'

export interface FileWriteConfig {
  path: string
  directory: Directory
  recursive?: boolean
  encoding?: Encoding
}

export abstract class FilterWriter {
  protected abstract getWriteConfig(filename: string): FileWriteConfig
  protected abstract handlePostWrite(result: WriteFileResult): Promise<void>
  protected abstract handleError(error: any): Promise<void>

  async checkOrRequestPermission?(): Promise<void> {
    // Default implementation - do nothing
  }

  async writeFileAutoRenameOnConflict(options: WriteFileOptions): Promise<WriteFileResult> {
    let counter = 1
    let currentPath = options.path

    while (true) {
      try {
        await Filesystem.stat({ ...options, path: currentPath })
        // File exists, try next increment
        const pathParts = options.path.split('.')
        const ext = pathParts.length > 1 ? pathParts.pop() : ''
        const baseName = pathParts.join('.')
        counter++
        currentPath = `${baseName}_${counter}${ext ? `.${ext}` : ''}`
      } catch (e) {
        // File doesn't exist, we can use this path
        return await Filesystem.writeFile({ ...options, path: currentPath })
      }
    }
  }

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    try {
      const data = await blob.text()
      const config = this.getWriteConfig(filename)
      const result = await Filesystem.writeFile({
        path: config.path,
        data: data,
        directory: config.directory,
        encoding: encoding as Encoding,
        recursive: config.recursive,
      })
      await this.handlePostWrite(result)
    } catch (error) {
      await this.handleError(error)
    }
  }

  async exportTextFile(filename: string, content: string) {
    try {
      const config = this.getWriteConfig(filename)
      const result = await Filesystem.writeFile({
        path: config.path,
        data: content,
        directory: config.directory,
        encoding: Encoding.UTF8,
        recursive: config.recursive,
      })
      await this.handlePostWrite(result)
    } catch (error) {
      await this.handleError(error)
    }
  }

  async exportImageFile(basename: string, base64Data: string) {
    try {
      let type = ''
      let data = base64Data

      const base64Match = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/)
      if (base64Match) {
        type = base64Match[1]
        data = base64Match[2]
      } else {
        type = 'image/png'
        data = base64Data
      }

      const ext = (type.split('/')[1] || 'png').split('+')[0]
      const filename = `${basename}.${ext}`
      const config = this.getWriteConfig(filename)

      const result = await Filesystem.writeFile({
        path: config.path,
        data: data,
        directory: config.directory,
        recursive: config.recursive,
      })
      await this.handlePostWrite(result)
    } catch (error) {
      await this.handleError(error)
    }
  }

  async exportByUrl(filename: string, url: string) {
    try {
      const config = this.getWriteConfig(filename)
      await this.ensureDirectoryExists(config)

      const file = await Filesystem.downloadFile({
        url: url,
        path: config.path,
        directory: config.directory,
        recursive: config.recursive,
      })
      await this.handlePostWrite({ uri: file.path || '' })
    } catch (error) {
      await this.handleError(error)
    }
  }

  async writeFirstChunk(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
      recursive: config.recursive,
    })
  }

  async appendChunk(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    await Filesystem.appendFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
  }

  async writeCompleteFile(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    const result = await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
      recursive: config.recursive,
    })
    await this.handlePostWrite(result)
  }

  async finishWriting(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    await Filesystem.appendFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
    await this.completeExport(filename)
  }

  async completeExport(filename: string) {
    const config = this.getWriteConfig(filename)
    const fileUri = await Filesystem.getUri({
      directory: config.directory,
      path: config.path,
    })
    await this.handlePostWrite(fileUri)
  }

  protected async ensureDirectoryExists(config: FileWriteConfig) {
    if (config.recursive) {
      const dirPath = config.path.split('/').slice(0, -1).join('/')
      if (dirPath) {
        try {
          await Filesystem.mkdir({
            path: dirPath,
            directory: config.directory,
            recursive: true,
          })
        } catch (_e) {
          // Directory already exists — safe to ignore on Android
        }
      }
    }
  }
}

export class IOSFilterWriter extends FilterWriter {
  protected getWriteConfig(filename: string): FileWriteConfig {
    return {
      path: filename,
      directory: Directory.Cache,
      recursive: false,
    }
  }

  protected async handlePostWrite(result: WriteFileResult): Promise<void> {
    await Share.share({
      title: i18n.t('Share File') || 'Share File',
      text: i18n.t('Share File') || 'Share File',
      url: result.uri,
      dialogTitle: i18n.t('Share File') || 'Share File',
    })
  }

  protected async handleError(error: any): Promise<void> {
    throw error
  }

  async exportTextFile(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    const result = await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
    await this.handlePostWrite(result)
  }

  async writeCompleteFile(filename: string, content: string) {
    const config = this.getWriteConfig(filename)
    const result = await Filesystem.writeFile({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
    })
    await this.handlePostWrite(result)
  }
}

export class AndroidFilterWriter extends FilterWriter {
  protected getWriteConfig(filename: string): FileWriteConfig {
    return {
      path: `chatbox_ai_exports/${filename}`,
      directory: Directory.Documents,
      recursive: true,
    }
  }

  protected async handlePostWrite(result: WriteFileResult): Promise<void> {
    await Toast.show({ text: i18n.t('File saved to {{uri}}', { uri: result.uri }) })
  }

  protected async handleError(error: any): Promise<void> {
    await Toast.show({
      text: i18n.t('Failed to save file: {{error}}', { error: error }),
    })
    throw error
  }

  async checkOrRequestPermission(): Promise<void> {
    let result = await Filesystem.checkPermissions()
    if (result.publicStorage === 'granted') {
      return
    }
    result = await Filesystem.requestPermissions()
    if (result.publicStorage === 'denied') {
      await Toast.show({ text: i18n.t('No permission to write file') })
    }
  }

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    await this.checkOrRequestPermission()
    const data = await blob.text()
    const config = this.getWriteConfig(filename)
    const result = await this.writeFileAutoRenameOnConflict({
      path: config.path,
      data: data,
      directory: config.directory,
      encoding: encoding as Encoding,
      recursive: config.recursive,
    })
    await this.handlePostWrite(result)
  }

  async exportTextFile(filename: string, content: string) {
    try {
      await this.checkOrRequestPermission()
      const config = this.getWriteConfig(filename)
      const result = await this.writeFileAutoRenameOnConflict({
        path: config.path,
        data: content,
        directory: config.directory,
        encoding: Encoding.UTF8,
        recursive: config.recursive,
      })
      await this.handlePostWrite(result)
    } catch (error) {
      await this.handleError(error)
    }
  }

  async exportImageFile(basename: string, base64Data: string) {
    await this.checkOrRequestPermission()
    return super.exportImageFile(basename, base64Data)
  }

  async exportByUrl(filename: string, url: string) {
    await this.checkOrRequestPermission()
    return super.exportByUrl(filename, url)
  }

  async writeFirstChunk(filename: string, content: string) {
    await this.checkOrRequestPermission()
    return super.writeFirstChunk(filename, content)
  }

  async writeCompleteFile(filename: string, content: string) {
    await this.checkOrRequestPermission()
    const config = this.getWriteConfig(filename)
    const result = await this.writeFileAutoRenameOnConflict({
      path: config.path,
      data: content,
      directory: config.directory,
      encoding: Encoding.UTF8,
      recursive: config.recursive,
    })
    await this.handlePostWrite(result)
  }
}
