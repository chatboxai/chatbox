import { tmpdir } from 'node:os'
import path from 'node:path'

export type ChatboxQaEnvironment = {
  // Index signature so `process.env` (NodeJS.ProcessEnv) is assignable: without
  // it TypeScript's weak-type check rejects an all-optional target.
  [key: string]: string | undefined
  CHATBOX_QA?: string
  CHATBOX_QA_TASK_ID?: string
  CHATBOX_QA_TASK_ROOT?: string
}

export type ChatboxQaRuntime = {
  enabled: boolean
  taskId: string | null
}

export type ChatboxQaPaths = {
  logsDir: string
  mainLogFile: string
  sandboxArtifactsRoot: string
  sandboxTmpRoot: string
  taskRoot: string
  tempDir: string
}

export type ChatboxQaLaunchArguments = {
  cdpPort: number
  userDataDir: string
}

export type ChatboxQaPreflight = {
  launchArguments: ChatboxQaLaunchArguments | null
  paths: ChatboxQaPaths | null
  runtime: ChatboxQaRuntime
}

export type MainRuntimePolicyOptions = {
  isHarmonyBuild: boolean
  isPackaged: boolean
}

export type MainRuntimePolicy = {
  createTray: boolean
  isQa: boolean
  qaTaskId: string | null
  registerGlobalShortcuts: boolean
  registerProtocolClient: boolean
  requestSingleInstanceLock: boolean
  startAppUpdater: boolean
}

const QA_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function readCommandLineOption(argv: string[], name: string): string | null {
  const option = `--${name}`
  const inlinePrefix = `${option}=`
  const inlineValue = argv.find((argument) => argument.startsWith(inlinePrefix))
  if (inlineValue) {
    return inlineValue.slice(inlinePrefix.length)
  }

  const optionIndex = argv.indexOf(option)
  return optionIndex >= 0 ? (argv[optionIndex + 1] ?? null) : null
}

function validateQaTaskId(env: ChatboxQaEnvironment): string {
  const taskId = env.CHATBOX_QA_TASK_ID
  if (!taskId) {
    throw new Error('CHATBOX_QA_TASK_ID is required when CHATBOX_QA=1')
  }
  if (!QA_TASK_ID_PATTERN.test(taskId)) {
    throw new Error(
      'CHATBOX_QA_TASK_ID must be 1-128 characters and contain only ASCII letters, numbers, underscores, or hyphens'
    )
  }
  return taskId
}

export function getChatboxQaRuntime(env: ChatboxQaEnvironment = process.env): ChatboxQaRuntime {
  const enabled = env.CHATBOX_QA === '1'
  return {
    enabled,
    taskId: enabled ? validateQaTaskId(env) : null,
  }
}

export function getChatboxQaTaskId(env: ChatboxQaEnvironment = process.env): string | null {
  return getChatboxQaRuntime(env).taskId
}

export function getChatboxQaLaunchArguments(
  argv: string[] = process.argv,
  env: ChatboxQaEnvironment = process.env
): ChatboxQaLaunchArguments | null {
  if (!getChatboxQaRuntime(env).enabled) {
    return null
  }

  const cdpPortValue = readCommandLineOption(argv, 'remote-debugging-port')
  const cdpPort = cdpPortValue && /^\d+$/.test(cdpPortValue) ? Number(cdpPortValue) : Number.NaN
  if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65_535) {
    throw new Error('CHATBOX_QA=1 requires --remote-debugging-port with a port between 1 and 65535')
  }

  const userDataDirValue = readCommandLineOption(argv, 'user-data-dir')
  if (!userDataDirValue || !path.isAbsolute(userDataDirValue)) {
    throw new Error('CHATBOX_QA=1 requires --user-data-dir with an absolute profile path')
  }

  return {
    cdpPort,
    userDataDir: path.resolve(userDataDirValue),
  }
}

export function getChatboxQaPreflight(
  argv: string[] = process.argv,
  env: ChatboxQaEnvironment = process.env
): ChatboxQaPreflight {
  const runtime = getChatboxQaRuntime(env)
  if (!runtime.enabled) {
    return { launchArguments: null, paths: null, runtime }
  }

  return {
    launchArguments: getChatboxQaLaunchArguments(argv, env),
    paths: getChatboxQaPaths(env),
    runtime,
  }
}

export function getChatboxQaPaths(env: ChatboxQaEnvironment = process.env): ChatboxQaPaths | null {
  const runtime = getChatboxQaRuntime(env)
  if (!runtime.enabled || !runtime.taskId) {
    return null
  }

  const requestedTaskRoot = env.CHATBOX_QA_TASK_ROOT || path.join(tmpdir(), 'chatbox-qa', runtime.taskId)
  if (!path.isAbsolute(requestedTaskRoot)) {
    throw new Error('CHATBOX_QA_TASK_ROOT must be an absolute task directory under a chatbox-qa namespace')
  }

  const taskRoot = path.resolve(requestedTaskRoot)
  const rootWithoutVolume = taskRoot.slice(path.parse(taskRoot).root.length)
  const taskRootSegments = rootWithoutVolume.split(path.sep).filter(Boolean)
  const qaNamespaceIndex = taskRootSegments.lastIndexOf('chatbox-qa')
  const taskDirectoryName = taskRootSegments[taskRootSegments.length - 1]
  if (
    qaNamespaceIndex < 0 ||
    qaNamespaceIndex === taskRootSegments.length - 1 ||
    !taskDirectoryName ||
    !QA_TASK_ID_PATTERN.test(taskDirectoryName)
  ) {
    throw new Error('CHATBOX_QA_TASK_ROOT must be an absolute task directory under a chatbox-qa namespace')
  }

  return {
    logsDir: path.join(taskRoot, 'logs'),
    mainLogFile: path.join(taskRoot, 'logs', 'main.log'),
    sandboxArtifactsRoot: path.join(taskRoot, 'chatbox-sandbox', 'artifacts'),
    sandboxTmpRoot: path.join(taskRoot, 'chatbox-sandbox', 'tmp'),
    taskRoot,
    tempDir: path.join(taskRoot, 'tmp'),
  }
}

export function getMainRuntimePolicy(env: ChatboxQaEnvironment, options: MainRuntimePolicyOptions): MainRuntimePolicy {
  const qaRuntime = getChatboxQaRuntime(env)

  return {
    createTray: !qaRuntime.enabled,
    isQa: qaRuntime.enabled,
    qaTaskId: qaRuntime.taskId,
    registerGlobalShortcuts: !qaRuntime.enabled,
    registerProtocolClient: !qaRuntime.enabled,
    requestSingleInstanceLock: options.isPackaged && !qaRuntime.enabled,
    startAppUpdater: !options.isHarmonyBuild && !qaRuntime.enabled,
  }
}
