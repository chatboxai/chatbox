import log from 'electron-log/main'
import path from 'path'
import { getChatboxQaPaths, getChatboxQaTaskId } from './qa-runtime'

export function resolveHtmlPath(htmlFileName: string) {
  if (process.env.NODE_ENV === 'development') {
    return process.env['ELECTRON_RENDERER_URL']
  }
  return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`
}

export function sliceTextWithEllipsis(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text
  }
  // 这里添加了一些根据文本的随机性，避免内容被截断
  const headLength = Math.floor(maxLength * 0.4) + Math.floor(text.length * 0.1)
  const tailLength = Math.floor(maxLength * 0.5)
  const head = text.slice(0, headLength)
  const tail = text.slice(-tailLength)

  return head + tail
}

// 初始化后，dev 模式可以收集到 renderer 层日志，但 electron 打包后无法正常工作
// log.initialize()

export function getLogger(logId: string) {
  const logger = log.create({ logId })
  const qaTaskId = getChatboxQaTaskId()
  const qaPrefix = qaTaskId ? `[QA:${qaTaskId}] ` : ''
  logger.transports.console.format = `${qaPrefix}{h}:{i}:{s}.{ms} › [{logId}] › {text}`
  logger.transports.file.format = `${qaPrefix}[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{logId}] {text}`

  const qaPaths = getChatboxQaPaths()
  if (qaPaths) {
    logger.transports.file.resolvePathFn = () => qaPaths.mainLogFile
  }
  return logger
}
