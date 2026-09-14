import { WORK_FOREGROUND_REQUIRED } from './execution-feedback'
import type { MobileSkillPreferences } from './skill-settings'
import { throwIfWorkAborted } from './abort'
import { validateWorkspaceFiles, type WorkspaceFiles } from './workspace-path'
import { isLocalDocument, MAX_PARSED_DOCUMENT_TEXT, type ParsedLocalDocument } from './document-parser'

export interface ExecutionResult {
  stdout: string
  files: WorkspaceFiles
  error?: string
  parsed?: ParsedLocalDocument
}
export interface ExecutionJob {
  id: string
  code: string
  files: WorkspaceFiles
  timeoutMs: number
  documentName?: string
  skillPreferences?: MobileSkillPreferences
}

/** Owns one disposable worker at a time; queued callers never share a JS context. */
export class MobileExecutionService {
  private listeners = new Set<() => void>()
  private job: ExecutionJob | null = null
  private finish: ((result?: ExecutionResult, error?: Error) => void) | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private foreground = true
  private disposed = false
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.job
  private emit() {
    for (const listener of this.listeners) listener()
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground
    if (!foreground) this.finish?.(undefined, new Error(WORK_FOREGROUND_REQUIRED))
  }

  async parseDocument(name: string, base64: string, signal: AbortSignal): Promise<ParsedLocalDocument> {
    if (!isLocalDocument(name)) throw new Error('Unsupported local document format')
    const result = await this.execute('', { document: { base64 } }, signal, name)
    if (result.error) throw new Error(result.error)
    if (!result.parsed) throw new Error('Document parser returned no content')
    return result.parsed
  }

  execute(
    code: string,
    files: WorkspaceFiles,
    signal: AbortSignal,
    documentName?: string,
    skillPreferences?: MobileSkillPreferences
  ): Promise<ExecutionResult> {
    if (signal.aborted) return Promise.reject(new Error('Execution stopped'))
    const run = this.tail
      .catch(() => undefined)
      .then(() => this.start(code, files, signal, documentName, skillPreferences))
    this.tail = run
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Execution stopped'))
      signal.addEventListener('abort', abort, { once: true })
      void run.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  private start(
    code: string,
    files: WorkspaceFiles,
    signal: AbortSignal,
    documentName?: string,
    skillPreferences?: MobileSkillPreferences
  ): Promise<ExecutionResult> {
    throwIfWorkAborted(signal)
    if (this.disposed) return Promise.reject(new Error('Execution host closed'))
    if (!this.foreground) return Promise.reject(new Error(WORK_FOREGROUND_REQUIRED))
    if (code.length > 100_000) return Promise.reject(new Error('Code exceeds the 100 KB limit'))
    validateWorkspaceFiles(files)
    return new Promise((resolve, reject) => {
      const abort = () => this.finish?.(undefined, new Error('Execution stopped'))
      const timer = setTimeout(() => this.finish?.(undefined, new Error('Execution timed out')), 30_000)
      this.finish = (result, error) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.finish = null
        this.job = null
        this.emit()
        if (error) reject(error)
        else if (result) resolve(result)
        else reject(new Error('Execution ended without a result'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.job = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        code,
        files,
        timeoutMs: 20_000,
        skillPreferences,
        ...(documentName ? { documentName } : {}),
      }
      this.emit()
    })
  }

  receive(id: string, result: ExecutionResult): void {
    if (id !== this.job?.id) return
    try {
      if (typeof result.stdout !== 'string' || result.stdout.length > 100_000)
        throw new Error('Invalid execution output')
      validateWorkspaceFiles(result.files)
      if (
        result.parsed &&
        (typeof result.parsed.text !== 'string' ||
          result.parsed.text.length > MAX_PARSED_DOCUMENT_TEXT ||
          typeof result.parsed.truncated !== 'boolean')
      )
        throw new Error('Invalid parsed document output')
      this.finish?.(result)
    } catch (error) {
      this.fail(id, error instanceof Error ? error : new Error(String(error)))
    }
  }
  fail(id: string, error: Error): void {
    if (id === this.job?.id) this.finish?.(undefined, error)
  }
  dispose(): void {
    this.disposed = true
    this.finish?.(undefined, new Error('Execution host closed'))
    this.listeners.clear()
  }
}
