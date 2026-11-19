import type { ExecutionResult } from '@shared/mobile-work/MobileExecutionService'
import type { WorkspaceFiles } from '@shared/mobile-work/workspace-path'
import { getLogger } from '@/lib/utils'

const log = getLogger('python-runtime')

/** Root of the Python working directory inside the WASM filesystem. */
const WORK_ROOT = '/home/pyodide/work'
const TIMEOUT_MS = 60_000
const MAX_OUTPUT_CHARS = 64 * 1024

/**
 * Wheels shipped beside the Pyodide assets (see `src/renderer/public/pyodide`).
 * They are pre-loaded so `import numpy` works without network access.
 * `micropip` is bundled too: it lets pure-Python packages be installed with
 * `micropip.install(...)` whenever the device has network access.
 */
const BUNDLED_PACKAGES = ['numpy', 'pandas', 'matplotlib', 'micropip']

interface PyodideRuntime {
  FS: {
    mkdirTree: (path: string) => void
    writeFile: (path: string, data: Uint8Array) => void
    readFile: (path: string) => Uint8Array
    readdir: (path: string) => string[]
    isDir: (mode: number) => boolean
    isFile: (mode: number) => boolean
    stat: (path: string) => { mode: number }
    analyzePath: (path: string) => { exists: boolean }
    unlink: (path: string) => void
    rmdir: (path: string) => void
  }
  runPythonAsync: (code: string) => Promise<unknown>
  loadPackage: (names: string | string[]) => Promise<unknown>
  setStdout: (options: { batched: (text: string) => void }) => void
  setStderr: (options: { batched: (text: string) => void }) => void
}

export interface PythonExecutor {
  execute(code: string, files: WorkspaceFiles, signal: AbortSignal): Promise<ExecutionResult>
}

let runtimePromise: Promise<PyodideRuntime> | null = null

function pyodideBaseUrl(): string {
  return new URL('/pyodide/', window.location.origin).href
}

/**
 * Load the Pyodide runtime from the bundled assets. The WebAssembly payload is
 * ~10 MB, so the load is lazy and shared by every later execution.
 */
async function loadRuntime(): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    const base = pyodideBaseUrl()
    log.info('Loading Pyodide runtime from', base)
    runtimePromise = (async () => {
      const module = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as {
        loadPyodide: (options: { indexURL: string }) => Promise<PyodideRuntime>
      }
      const runtime = await module.loadPyodide({ indexURL: base })
      await preloadBundledPackages(runtime)
      return runtime
    })().catch((error) => {
      runtimePromise = null
      log.error('Failed to load Pyodide:', error)
      throw error
    })
  }
  return runtimePromise
}

/**
 * Pull the bundled scientific stack into the interpreter. The wheels sit next
 * to the runtime, so `loadPackage` resolves them from `indexURL` and never
 * touches the network. A failure here only costs the third-party packages:
 * the standard library stays usable.
 */
async function preloadBundledPackages(runtime: PyodideRuntime): Promise<void> {
  try {
    await runtime.loadPackage(BUNDLED_PACKAGES)
    log.info('Loaded bundled Python packages:', BUNDLED_PACKAGES.join(', '))
  } catch (error) {
    log.warn('Failed to load bundled Python packages:', error)
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[Output truncated]` : text
}

function clearWorkDirectory(runtime: PyodideRuntime): void {
  if (!runtime.FS.analyzePath(WORK_ROOT).exists) {
    runtime.FS.mkdirTree(WORK_ROOT)
    return
  }
  for (const entry of runtime.FS.readdir(WORK_ROOT)) {
    if (entry === '.' || entry === '..') continue
    removePath(runtime, `${WORK_ROOT}/${entry}`)
  }
}

function removePath(runtime: PyodideRuntime, path: string): void {
  const stat = runtime.FS.stat(path)
  if (runtime.FS.isDir(stat.mode)) {
    for (const entry of runtime.FS.readdir(path)) {
      if (entry === '.' || entry === '..') continue
      removePath(runtime, `${path}/${entry}`)
    }
    runtime.FS.rmdir(path)
    return
  }
  runtime.FS.unlink(path)
}

function seedFiles(runtime: PyodideRuntime, files: WorkspaceFiles): Map<string, string> {
  const seeded = new Map<string, string>()
  for (const [path, file] of Object.entries(files)) {
    const target = `${WORK_ROOT}/${path}`
    const slash = target.lastIndexOf('/')
    if (slash > 0) runtime.FS.mkdirTree(target.slice(0, slash))
    runtime.FS.writeFile(target, base64ToBytes(file.base64))
    seeded.set(path, file.base64)
  }
  return seeded
}

function collectFiles(runtime: PyodideRuntime, seeded: Map<string, string>): WorkspaceFiles {
  const collected: WorkspaceFiles = {}
  const walk = (directory: string, prefix: string) => {
    for (const entry of runtime.FS.readdir(directory)) {
      if (entry === '.' || entry === '..') continue
      const absolute = `${directory}/${entry}`
      const relative = prefix ? `${prefix}/${entry}` : entry
      // `input/` and `artifacts/` are read-only in the workspace contract: they are
      // copied into the sandbox for reading, but never written back from it.
      if (isReadOnlyWorkspacePath(relative)) continue
      const stat = runtime.FS.stat(absolute)
      if (runtime.FS.isDir(stat.mode)) {
        walk(absolute, relative)
        continue
      }
      if (!runtime.FS.isFile(stat.mode)) continue
      const base64 = bytesToBase64(runtime.FS.readFile(absolute))
      // Only report files the script created or modified, mirroring the JavaScript
      // sandbox, so untouched workspace files are not rewritten on every run.
      if (seeded.get(relative) === base64) continue
      collected[relative] = { base64 }
    }
  }
  walk(WORK_ROOT, '')
  return collected
}

function isReadOnlyWorkspacePath(path: string): boolean {
  return path.startsWith('input/') || path.startsWith('artifacts/')
}

async function runWithTimeout(runtime: PyodideRuntime, code: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Python execution timed out')), TIMEOUT_MS)
  })
  try {
    await Promise.race([runtime.runPythonAsync(code), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function executePython(code: string, files: WorkspaceFiles, signal: AbortSignal): Promise<ExecutionResult> {
  if (signal.aborted) throw new Error('Execution stopped')
  const runtime = await loadRuntime()
  if (signal.aborted) throw new Error('Execution stopped')

  clearWorkDirectory(runtime)
  const seeded = seedFiles(runtime, files)

  const stdout: string[] = []
  const stderr: string[] = []
  runtime.setStdout({ batched: (text) => stdout.push(text) })
  runtime.setStderr({ batched: (text) => stderr.push(text) })
  runtime.runPythonAsync(`import os\nos.chdir(${JSON.stringify(WORK_ROOT)})`).catch(() => undefined)

  let error: string | undefined
  try {
    await runWithTimeout(runtime, code)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    error = message
    log.warn('Python execution failed:', message)
  }

  if (signal.aborted) throw new Error('Execution stopped')

  const output = [...stdout, ...stderr].join('\n')
  return {
    stdout: truncate(output),
    files: error ? {} : collectFiles(runtime, seeded),
    ...(error ? { error } : {}),
  }
}

export const capacitorPython: PythonExecutor = { execute: executePython }
