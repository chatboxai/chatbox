import { isMobileSkillEnabled, type MobileSkillId, type MobileSkillPreferences } from '../skill-settings'
import RELEASE_SYNC from '@jitl/quickjs-singlefile-browser-release-sync'
import { newQuickJSWASMModuleFromVariant, type QuickJSDeferredPromise } from 'quickjs-emscripten-core'
import { decodeBase64, encodeBase64, type EncodedFile, MAX_FILE_BYTES, WorkerFiles } from './files'

export interface WorkerRequest {
  id: string
  code: string
  files: Record<string, EncodedFile>
  timeoutMs?: number
  skillPreferences?: MobileSkillPreferences
  documentName?: string
}

export interface WorkerResponse {
  id: string
  result: {
    stdout: string
    files: Record<string, EncodedFile>
    error?: string
    parsed?: import('../document-parser').ParsedLocalDocument
  }
}

let modulePromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined
const MAX_OUTPUT = 64 * 1024

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runRequest(request: WorkerRequest): Promise<WorkerResponse> {
  let stdout = ''
  let files: WorkerFiles | undefined
  try {
    if (request.documentName !== undefined) {
      if (typeof request.documentName !== 'string' || request.documentName.length > 240)
        throw new Error('Invalid document name')
      const { parseLocalDocument } = await import('./document-parser')
      const parsed = await parseLocalDocument(request.documentName, decodeBase64(request.files.document.base64))
      return { id: request.id, result: { stdout: '', files: {}, parsed } }
    }
    if (
      typeof request.id !== 'string' ||
      request.id.length > 128 ||
      typeof request.code !== 'string' ||
      request.code.length > 256 * 1024
    )
      throw new Error('Invalid execution request')
    const timeoutMs = request.timeoutMs ?? 20_000
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000)
      throw new Error('Execution timeout must be between 1 and 20000 ms')
    files = new WorkerFiles(request.files)
    const workspace = files
    const QuickJS = await (modulePromise ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC))
    const runtime = QuickJS.newRuntime()
    runtime.setMemoryLimit(32 * 1024 * 1024)
    runtime.setMaxStackSize(512 * 1024)
    const deadline = Date.now() + timeoutMs
    runtime.setInterruptHandler(() => Date.now() >= deadline)
    const context = runtime.newContext()
    const deferreds = new Set<QuickJSDeferredPromise>()
    let active = true
    let operationCount = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const pump = () => {
      const jobs = runtime.executePendingJobs()
      if (jobs.error) {
        const error = context.dump(jobs.error)
        jobs.error.dispose()
        throw new Error(JSON.stringify(error))
      }
    }
    const handlers: Record<string, (...args: unknown[]) => unknown> = {
      'files.readText': (path) => new TextDecoder().decode(workspace.read(path)),
      'files.writeText': (path, value) => {
        if (typeof value !== 'string' || value.length > MAX_FILE_BYTES)
          throw new Error('Invalid or oversized text file')
        workspace.write(path, new TextEncoder().encode(value))
        return { path }
      },
      'files.readBase64': (path) => encodeBase64(workspace.read(path)),
      'files.writeBase64': (path, value) => {
        workspace.write(path, decodeBase64(value))
        return { path }
      },
      'files.list': () => workspace.list(),
    }
    let documentsPromise: Promise<ReturnType<typeof import('./documents')['createDocumentTools']>> | undefined
    for (const method of [
      'readSpreadsheet',
      'writeSpreadsheet',
      'writePresentation',
      'readDocument',
      'readPresentation',
    ] as const) {
      handlers[`docs.${method}`] = async (...args) => {
        const skill: MobileSkillId = method.includes('Spreadsheet')
          ? 'spreadsheets'
          : method.includes('Presentation')
            ? 'presentations'
            : 'documents'
        if (!isMobileSkillEnabled(skill, request.skillPreferences))
          throw new Error(`Enable the ${skill} skill in Settings to use this document helper`)
        documentsPromise ??= import('./documents').then(({ createDocumentTools }) => createDocumentTools(workspace))
        const documents = await documentsPromise
        if (!active || Date.now() >= deadline) throw new Error('Execution timed out')
        return documents[method](args[0], args[1])
      }
    }
    try {
      const bridge = context.newFunction('__call', (methodHandle, argumentHandle) => {
        if (++operationCount > 10_000) throw new Error('Execution exceeds 10000 file/document operations')
        const method = context.getString(methodHandle)
        if (!Object.hasOwn(handlers, method)) throw new Error('Unknown runtime operation')
        const serialized = context.getString(argumentHandle)
        if (serialized.length > 16 * 1024 * 1024) throw new Error('Operation arguments exceed size limit')
        const args: unknown = JSON.parse(serialized)
        if (!Array.isArray(args)) throw new Error('Operation arguments must be an array')
        const deferred = context.newPromise()
        deferreds.add(deferred)
        void Promise.resolve()
          .then(() => {
            if (!active || Date.now() >= deadline) throw new Error('Execution timed out')
            return handlers[method](...args)
          })
          .then((value) => {
            if (!active) return
            const serialized = JSON.stringify(value ?? null)
            if (serialized.length > 16 * 1024 * 1024) throw new Error('Operation result exceeds size limit')
            const result = context.newString(serialized)
            deferred.resolve(result)
            result.dispose()
          })
          .catch((error: unknown) => {
            if (!active) return
            const result = context.newError(message(error))
            deferred.reject(result)
            result.dispose()
          })
          .finally(() => {
            if (!active) return
            try {
              pump()
            } catch {
              // The root promise or deadline reports guest failures.
            } finally {
              deferreds.delete(deferred)
              if (deferred.alive) deferred.dispose()
            }
          })
        return deferred.handle
      })
      context.setProp(context.global, '__call', bridge)
      bridge.dispose()
      const log = context.newFunction('__log', (value) => {
        const line = context.getString(value)
        if (stdout.length + line.length + 1 > MAX_OUTPUT) throw new Error('Console output exceeds 64 KiB limit')
        stdout += `${line}\n`
      })
      context.setProp(context.global, '__log', log)
      log.dispose()
      const bootstrap = context.evalCode(`
        (() => {
          const call = globalThis.__call;
          const log = globalThis.__log;
          delete globalThis.__call;
          delete globalThis.__log;
          const invoke = (name) => async (...args) => JSON.parse(await call(name, JSON.stringify(args)));
          globalThis.files = Object.freeze(Object.fromEntries(['readText', 'writeText', 'readBase64', 'writeBase64', 'list'].map(name => [name, invoke('files.' + name)])));
          globalThis.docs = Object.freeze(Object.fromEntries(['readSpreadsheet', 'writeSpreadsheet', 'writePresentation', 'readDocument', 'readPresentation'].map(name => [name, invoke('docs.' + name)])));
          globalThis.console = Object.freeze(Object.fromEntries(['log', 'info', 'warn', 'error'].map(name => [name, (...values) => log(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '))])));
        })();
      `)
      context.unwrapResult(bootstrap).dispose()
      const evaluated = context.evalCode(`(async () => {\n${request.code}\n})()`, 'task.js')
      const root = context.unwrapResult(evaluated)
      try {
        const completion = context.resolvePromise(root)
        pump()
        // The parent terminates this disposable worker at the same deadline.
        // This timer also settles a guest promise that never schedules more jobs.
        const deadlinePromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Execution timed out')), Math.max(1, deadline - Date.now()))
        })
        const outcome = await Promise.race([completion, deadlinePromise])
        context.unwrapResult(outcome).dispose()
      } finally {
        root.dispose()
      }
    } finally {
      active = false
      if (timer) clearTimeout(timer)
      for (const deferred of deferreds) if (deferred.alive) deferred.dispose()
      context.dispose()
      runtime.dispose()
    }
    return { id: request.id, result: { stdout, files: workspace.serialize() } }
  } catch (error) {
    return { id: request?.id ?? '', result: { stdout, files: files?.serialize() ?? {}, error: message(error) } }
  }
}
