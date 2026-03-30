/**
 * 文件对话集成测试框架
 *
 * 用于测试 AI 通过 tools (read_file, search_file_content) 读取文件内容的机制
 *
 * 使用方式：
 * 1. 设置环境变量 CHATBOX_LICENSE_KEY
 * 2. 运行 pnpm test:file-conversation
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ModelMessage } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import TestPlatform from '../../../src/renderer/platform/test_platform'
import type { Message, SessionSettings, Settings, StreamTextResult } from '../../../src/shared/types'
import type { ModelDependencies } from '../../../src/shared/types/adapters'
import { createMockModelDependencies } from '../mocks/model-dependencies'
import { MockSentryAdapter } from '../mocks/sentry'

// ============ 类型定义 ============

export interface TestFile {
  /** 存储键名，用于在 platform.getStoreBlob 中查找 */
  storageKey: string
  /** 文件名 */
  fileName: string
  /** 文件类型 */
  fileType: string
  /** 文件内容 */
  content: string
}

export interface TestMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 附带的文件（仅 user 消息有效） */
  files?: Array<{
    storageKey: string
    fileName: string
    fileType: string
  }>
}

export interface FileConversationTestCase {
  /** 测试用例名称 */
  name: string
  /** 测试描述 */
  description?: string
  /** 预加载的文件 */
  files: TestFile[]
  /** 对话消息序列 */
  messages: TestMessage[]
  /** 模型设置覆盖 */
  modelSettings?: Partial<SessionSettings>
  /** 验证函数 */
  validate?: (result: TestResult) => void
}

export interface TestResult {
  /** 测试用例名称 */
  testName: string
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 最终的会话消息 */
  messages: Message[]
  /** AI SDK 消息 */
  coreMessages?: ModelMessage[]
  /** AI 响应结果 */
  response?: StreamTextResult
  /** 执行时间（毫秒） */
  duration: number
  /** 工具调用记录 */
  toolCalls: Array<{
    toolName: string
    args: any
    result: any
  }>
}

// ============ 测试上下文 ============

/**
 * 创建带文件引用的用户消息
 * 只创建基础的消息结构，包含文件引用（storageKey）
 * 实际的 ATTACHMENT_FILE 标记由 genMessageContext 在运行时生成
 */
export function createUserMessageWithFiles(content: string, files: TestFile[]): Message {
  const message: Message = {
    id: uuidv4(),
    role: 'user',
    contentParts: [{ type: 'text', text: content }],
    timestamp: Date.now(),
  }

  message.files = files.map((f) => ({
    id: `file-${f.storageKey}`,
    name: f.fileName,
    fileType: f.fileType,
    storageKey: f.storageKey,
  }))

  return message
}

export class FileConversationTestContext {
  public platform: TestPlatform
  public sentry: MockSentryAdapter

  constructor() {
    this.platform = new TestPlatform()
    this.sentry = new MockSentryAdapter()
  }

  /**
   * 创建模型依赖
   * 使用真实的请求适配器，mock sentry，使用 TestPlatform 的存储
   */
  async createModelDependencies(): Promise<ModelDependencies> {
    return createMockModelDependencies(this.platform, this.sentry)
  }

  /**
   * 加载测试文件到 platform
   */
  loadFiles(files: TestFile[]): void {
    for (const file of files) {
      this.platform.loadFile(file.storageKey, file.content)
    }
  }

  /**
   * 创建 Message 对象
   */
  createMessage(msg: TestMessage): Message {
    const message: Message = {
      id: uuidv4(),
      role: msg.role,
      contentParts: msg.content ? [{ type: 'text', text: msg.content }] : [],
      timestamp: Date.now(),
    }

    if (msg.files && msg.files.length > 0) {
      message.files = msg.files.map((f) => ({
        id: uuidv4(),
        name: f.fileName,
        fileType: f.fileType,
        storageKey: f.storageKey,
      }))
    }

    return message
  }

  /**
   * 清理测试上下文
   */
  clear(): void {
    this.platform.clear()
    this.sentry.clear()
  }
}

// ============ 测试运行器 ============

export interface TestRunnerOptions {
  /** License key for ChatboxAI */
  licenseKey: string
  /** 输出目录 */
  outputDir: string
  /** 默认模型设置 */
  defaultModelSettings?: Partial<SessionSettings>
  /** 全局设置 */
  globalSettings?: Partial<Settings>
  /** 是否打印详细日志 */
  verbose?: boolean
}

export class FileConversationTestRunner {
  private context: FileConversationTestContext
  private options: TestRunnerOptions
  private results: TestResult[] = []

  constructor(options: TestRunnerOptions) {
    this.options = options
    this.context = new FileConversationTestContext()

    // 确保输出目录存在
    if (!fs.existsSync(options.outputDir)) {
      fs.mkdirSync(options.outputDir, { recursive: true })
    }
  }

  /**
   * 运行单个测试用例
   */
  async runTest(testCase: FileConversationTestCase): Promise<TestResult> {
    const startTime = Date.now()
    const toolCalls: TestResult['toolCalls'] = []

    console.log(`\n[Test] Running: ${testCase.name}`)
    if (testCase.description) {
      console.log(`  Description: ${testCase.description}`)
    }

    try {
      // 清理之前的状态
      this.context.clear()

      // 加载测试文件
      this.context.loadFiles(testCase.files)
      console.log(`  Loaded ${testCase.files.length} file(s)`)

      // 创建消息序列（原始消息，不含 ATTACHMENT 标记）
      const rawMessages: Message[] = testCase.messages.map((m) => this.context.createMessage(m))
      console.log(`  Created ${rawMessages.length} message(s)`)

      // 准备模型设置
      const globalSettings = this.buildGlobalSettings()
      const sessionSettings = this.buildSessionSettings(testCase.modelSettings)

      // 创建模型依赖
      const dependencies = await this.context.createModelDependencies()

      // 动态导入模型相关模块（避免在模块加载时就初始化 platform）
      const { getModel } = await import('../../../src/shared/models')
      const { streamText } = await import('../../../src/renderer/packages/model-calls/stream-text')
      const { genMessageContext } = await import('../../../src/renderer/stores/sessionActions')

      // 获取配置
      const config = await this.context.platform.getConfig()

      // 创建模型实例
      const model = getModel(sessionSettings, globalSettings, config, dependencies)
      console.log(`  Using model: ${model.modelId}`)

      // 创建存储适配器，用于 genMessageContext 读取文件内容
      const testPlatform = this.context.platform
      const storageAdapter = {
        getBlob: async (key: string): Promise<string> => {
          const blob = await testPlatform.getStoreBlob(key)
          return blob ?? ''
        },
      }

      // 使用真实的 genMessageContext 处理消息
      const modelSupportToolUseForFile = model.isSupportToolUse('read-file')
      const promptMessages = await genMessageContext(
        sessionSettings,
        rawMessages,
        modelSupportToolUseForFile,
        storageAdapter
      )
      console.log(
        `  genMessageContext: modelSupportToolUseForFile=${modelSupportToolUseForFile}, messages=${promptMessages.length}`
      )

      // 执行对话
      let streamResult: { result: StreamTextResult; coreMessages: ModelMessage[] } | undefined

      // 替换 platform 实例（用于 file tool set 访问）
      const originalPlatform = await this.replacePlatformForTest()

      const processedToolCallIds = new Set<string>()
      try {
        streamResult = await streamText(
          model,
          {
            messages: promptMessages,
            onResultChangeWithCancel: (result) => {
              // 收集工具调用
              if (result.contentParts) {
                for (const part of result.contentParts) {
                  if (part.type === 'tool-call' && part.state === 'result') {
                    const tc = part as any
                    // 使用 toolCallId 避免重复添加
                    if (tc.toolCallId && !processedToolCallIds.has(tc.toolCallId)) {
                      processedToolCallIds.add(tc.toolCallId)
                      toolCalls.push({
                        toolName: tc.toolName,
                        args: tc.args,
                        result: tc.result,
                      })
                    }
                  }
                }
              }
            },
          },
          undefined
        )
      } finally {
        // 恢复原始 platform
        await this.restorePlatform(originalPlatform)
      }
      const { result: response, coreMessages } = streamResult!

      // 添加响应到消息列表
      const finalMessages = [...promptMessages]
      if (response) {
        const assistantMessage: Message = {
          id: uuidv4(),
          role: 'assistant',
          contentParts: response.contentParts || [],
          timestamp: Date.now(),
        }
        finalMessages.push(assistantMessage)
      }

      const duration = Date.now() - startTime
      const result: TestResult = {
        testName: testCase.name,
        success: true,
        messages: finalMessages,
        coreMessages,
        response,
        duration,
        toolCalls,
      }

      // 运行验证函数
      if (testCase.validate) {
        try {
          testCase.validate(result)
        } catch (validationError: any) {
          result.success = false
          result.error = `Validation failed: ${validationError.message}`
        }
      }

      console.log(`  ✓ Completed in ${duration}ms`)
      if (toolCalls.length > 0) {
        console.log(`  Tool calls: ${toolCalls.map((t) => t.toolName).join(', ')}`)
      }

      return result
    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`  ✗ Failed: ${error.message}`)

      return {
        testName: testCase.name,
        success: false,
        error: error.message,
        messages: [],
        duration,
        toolCalls,
      }
    }
  }

  /**
   * 运行多个测试用例
   */
  async runTests(testCases: FileConversationTestCase[]): Promise<TestResult[]> {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Running ${testCases.length} file conversation test(s)`)
    console.log(`${'='.repeat(60)}`)

    for (const testCase of testCases) {
      const result = await this.runTest(testCase)
      this.results.push(result)
    }

    // 输出汇总
    this.printSummary()

    // 导出结果
    await this.exportResults()

    return this.results
  }

  /**
   * 打印测试汇总
   */
  private printSummary(): void {
    const passed = this.results.filter((r) => r.success).length
    const failed = this.results.length - passed
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)

    console.log(`\n${'='.repeat(60)}`)
    console.log(`Test Summary`)
    console.log(`${'='.repeat(60)}`)
    console.log(`Total: ${this.results.length}`)
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${failed}`)
    console.log(`Duration: ${totalDuration}ms`)

    if (failed > 0) {
      console.log(`\nFailed tests:`)
      for (const result of this.results.filter((r) => !r.success)) {
        console.log(`  - ${result.testName}: ${result.error}`)
      }
    }
  }

  /**
   * 导出测试结果到文件
   */
  async exportResults(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputPath = path.join(this.options.outputDir, `results-${timestamp}.json`)

    const exportData = {
      timestamp: new Date().toISOString(),
      options: {
        ...this.options,
        licenseKey: '***', // 隐藏敏感信息
      },
      summary: {
        total: this.results.length,
        passed: this.results.filter((r) => r.success).length,
        failed: this.results.filter((r) => !r.success).length,
      },
      results: this.results.map((r) => ({
        ...r,
        // 简化消息内容以便阅读
        messages: r.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.contentParts
            .filter((p) => p.type === 'text')
            .map((p) => (p as any).text)
            .join(''),
          files: m.files?.map((f) => ({ name: f.name, storageKey: f.storageKey })),
        })),
      })),
    }

    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2))
    console.log(`\nResults exported to: ${outputPath}`)
  }

  /**
   * 构建全局设置
   */
  private buildGlobalSettings(): Settings {
    const baseSettings = {
      licenseKey: this.options.licenseKey,
      language: 'en' as const,
      ...this.options.globalSettings,
    }

    // 确保 providers 配置存在
    return baseSettings as Settings
  }

  /**
   * 构建会话设置
   */
  private buildSessionSettings(overrides?: Partial<SessionSettings>): SessionSettings {
    return {
      provider: 'ChatboxAI',
      modelId: 'gpt-4o-mini',
      temperature: 0.7,
      topP: 1,
      maxContextMessageCount: 20,
      stream: true,
      ...this.options.defaultModelSettings,
      ...overrides,
    } as SessionSettings
  }

  /**
   * 替换 platform 用于测试
   * 返回原始 platform 以便恢复
   */
  private async replacePlatformForTest(): Promise<any> {
    // 这里需要动态修改 platform 模块的默认导出
    // 由于 ES modules 的限制，我们通过修改 file tool set 使用的 platform 来实现
    // 实际上 file tool set 直接 import platform，所以我们需要确保在测试时使用 TestPlatform

    // 方案：在测试运行前，将文件内容预加载到 TestPlatform，
    // 然后通过 mock platform 模块来使用 TestPlatform
    // 这在 vitest 中通过 vi.mock 实现

    return null
  }

  /**
   * 恢复原始 platform
   */
  private async restorePlatform(original: any): Promise<void> {
    // no-op for now
  }
}

// ============ 便捷函数 ============

export interface RunConversationTestOptions {
  /** 测试名称 */
  testName: string
  /** 测试文件 */
  files: TestFile[]
  /** 用户消息 */
  userMessage: string
  /** License key */
  licenseKey: string
  /** 预设的 system prompt（可选） */
  systemPrompt?: string
  /** 验证函数 */
  validate?: (result: TestResult) => void
  /** 模型设置 */
  sessionSettings?: Partial<SessionSettings>
  /** 全局设置 */
  globalSettings?: Partial<Settings>
  /** Platform 实例（用于 mock） */
  platform?: TestPlatform
}

/**
 * 运行单个对话测试（便捷函数）
 * 用于在测试文件中直接调用，无需创建 TestRunner 实例
 *
 * 使用真实的 genMessageContext 来构造消息上下文（包括文件附件处理）
 */
export async function runConversationTest(options: RunConversationTestOptions): Promise<TestResult> {
  const { testName, files, userMessage, licenseKey, validate, platform } = options
  const startTime = Date.now()
  const toolCalls: TestResult['toolCalls'] = []
  const processedToolCallIds = new Set<string>()

  console.log(`\n[Test] ${testName}`)

  try {
    // 使用传入的 platform 或创建新的
    const testPlatform = platform || new TestPlatform()

    // 加载文件到 platform
    for (const file of files) {
      testPlatform.loadFile(file.storageKey, file.content)
    }
    console.log(`  Loaded ${files.length} file(s)`)

    // 创建原始消息列表
    const rawMessages: Message[] = []

    // 如果有 system prompt，添加 system 消息
    if (options.systemPrompt) {
      const { createMessage } = await import('../../../src/shared/types')
      const systemMsg = createMessage('system', options.systemPrompt)
      rawMessages.push(systemMsg)
      console.log(`  Added system prompt (${options.systemPrompt.length} chars)`)
    }

    // 创建用户消息（只包含文件引用，不包含 ATTACHMENT 标记）
    const userMsg = createUserMessageWithFiles(userMessage, files)
    rawMessages.push(userMsg)

    // 准备设置
    const globalSettings: Settings = {
      licenseKey,
      language: 'en',
      ...options.globalSettings,
    } as Settings

    const sessionSettings: SessionSettings = {
      provider: 'chatbox-ai',
      modelId: 'gpt-5-mini',
      temperature: 0.3,
      topP: 1,
      maxContextMessageCount: 20,
      stream: true,
      ...options.sessionSettings,
    } as SessionSettings

    // 创建模型依赖
    const context = new FileConversationTestContext()
    context.platform = testPlatform
    const dependencies = await context.createModelDependencies()
    const config = await testPlatform.getConfig()

    // 动态导入模型相关模块
    const { getModel } = await import('../../../src/shared/models')
    const { streamText } = await import('../../../src/renderer/packages/model-calls/stream-text')
    const { genMessageContext } = await import('../../../src/renderer/stores/sessionActions')

    // 创建模型
    const model = getModel(sessionSettings, globalSettings, config, dependencies)
    console.log(`  Using model: ${model.modelId}`)

    // 创建存储适配器，用于 genMessageContext 读取文件内容
    const storageAdapter = {
      getBlob: async (key: string): Promise<string> => {
        const blob = await testPlatform.getStoreBlob(key)
        return blob ?? ''
      },
    }

    // 使用真实的 genMessageContext 处理消息
    // 这会：1) 读取文件内容 2) 添加 ATTACHMENT_FILE 标记
    const modelSupportToolUseForFile = model.isSupportToolUse('read-file')
    const promptMessages = await genMessageContext(
      sessionSettings,
      rawMessages,
      modelSupportToolUseForFile,
      storageAdapter
    )
    console.log(
      `  genMessageContext: modelSupportToolUseForFile=${modelSupportToolUseForFile}, messages=${promptMessages.length}`
    )

    // 执行对话
    const streamResult = await streamText(
      model,
      {
        messages: promptMessages,
        onResultChangeWithCancel: (result) => {
          // 收集工具调用
          if (result.contentParts) {
            for (const part of result.contentParts) {
              if (part.type === 'tool-call' && (part as any).state === 'result') {
                const tc = part as any
                // 使用 toolCallId 避免重复添加
                if (tc.toolCallId && !processedToolCallIds.has(tc.toolCallId)) {
                  processedToolCallIds.add(tc.toolCallId)
                  toolCalls.push({
                    toolName: tc.toolName,
                    args: tc.args,
                    result: tc.result,
                  })
                }
              }
            }
          }
        },
      },
      undefined
    )
    const { result: response, coreMessages } = streamResult!

    // 添加响应到消息
    const finalMessages = [...promptMessages]
    if (response) {
      const assistantMsg: Message = {
        id: uuidv4(),
        role: 'assistant',
        contentParts: response.contentParts || [],
        timestamp: Date.now(),
      }
      finalMessages.push(assistantMsg)
    }

    const duration = Date.now() - startTime
    const result: TestResult = {
      testName,
      success: true,
      messages: finalMessages,
      coreMessages,
      response,
      duration,
      toolCalls,
    }

    // 运行验证
    if (validate) {
      try {
        validate(result)
      } catch (err: any) {
        result.success = false
        result.error = `Validation failed: ${err.message}`
      }
    }

    console.log(`  ✓ Completed in ${duration}ms`)
    if (toolCalls.length > 0) {
      console.log(`  Tool calls: ${toolCalls.map((t) => t.toolName).join(', ')}`)
    }

    return result
  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error(`  ✗ Failed: ${error.message}`)

    return {
      testName,
      success: false,
      error: error.message,
      messages: [],
      duration,
      toolCalls,
    }
  }
}

/**
 * 创建测试文件对象
 */
export function createTestFile(fileName: string, content: string, fileType: string = 'text/plain'): TestFile {
  return {
    storageKey: `file:test:${uuidv4()}`,
    fileName,
    fileType,
    content,
  }
}

/**
 * 从实际文件加载测试文件
 */
export function loadTestFileFromDisk(filePath: string, fileType?: string): TestFile {
  const content = fs.readFileSync(filePath, 'utf-8')
  const fileName = path.basename(filePath)
  const detectedType = fileType || detectFileType(fileName)

  return createTestFile(fileName, content, detectedType)
}

/**
 * 检测文件类型
 */
function detectFileType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  const typeMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.py': 'text/x-python',
    '.html': 'text/html',
    '.css': 'text/css',
    '.xml': 'text/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
  }
  return typeMap[ext] || 'text/plain'
}
