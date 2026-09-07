import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type ChatboxQaEnvironment,
  getChatboxQaLaunchArguments,
  getChatboxQaPaths,
  getChatboxQaPreflight,
  getChatboxQaRuntime,
  getChatboxQaTaskId,
  getMainRuntimePolicy,
} from './qa-runtime'

describe('getChatboxQaRuntime', () => {
  it('returns a validated task id only for the explicit QA mode', () => {
    expect(getChatboxQaRuntime({ CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: '20260811_real-task-01' })).toEqual({
      enabled: true,
      taskId: '20260811_real-task-01',
    })
    expect(getChatboxQaTaskId({ CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: 'task-01' })).toBe('task-01')
  })

  it.each<ChatboxQaEnvironment>([
    { CHATBOX_QA: '1' },
    { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: '' },
    { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: '../task' },
    { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: 'task/one' },
    { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: 'task one' },
    { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: '-task' },
    { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: `task-${'a'.repeat(124)}` },
  ])('rejects a missing or unsafe QA task id: %o', (env) => {
    expect(() => getChatboxQaRuntime(env)).toThrow(/CHATBOX_QA_TASK_ID/)
  })

  it('does not activate QA behavior for truthy-looking values other than 1', () => {
    expect(getChatboxQaRuntime({ CHATBOX_QA: 'true', CHATBOX_QA_TASK_ID: '../unused' })).toEqual({
      enabled: false,
      taskId: null,
    })
    expect(getChatboxQaTaskId({})).toBeNull()
    expect(getChatboxQaPaths({})).toBeNull()
    expect(getChatboxQaLaunchArguments(['electron'], {})).toBeNull()
    expect(getChatboxQaPreflight(['electron'], {})).toEqual({
      launchArguments: null,
      paths: null,
      runtime: { enabled: false, taskId: null },
    })
  })

  it('requires explicit CDP and profile arguments in QA mode', () => {
    const env = { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: 'task-01' }
    const profilePath = path.join(tmpdir(), 'chatbox-profile')
    expect(() => getChatboxQaLaunchArguments(['electron'], env)).toThrow(/remote-debugging-port/)
    expect(() => getChatboxQaLaunchArguments(['electron', '--remote-debugging-port=9311'], env)).toThrow(
      /user-data-dir/
    )
    expect(() =>
      getChatboxQaLaunchArguments(['electron', '--remote-debugging-port=0', `--user-data-dir=${profilePath}`], env)
    ).toThrow(/remote-debugging-port/)
    expect(() =>
      getChatboxQaLaunchArguments(['electron', '--remote-debugging-port=9311', '--user-data-dir=relative/profile'], env)
    ).toThrow(/user-data-dir/)
  })

  it('reads inline or separated Electron QA launch arguments', () => {
    const env = { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: 'task-01' }
    const firstProfilePath = path.join(tmpdir(), 'chatbox-profile')
    const secondProfilePath = path.join(tmpdir(), 'chatbox-profile-2')
    expect(
      getChatboxQaLaunchArguments(
        ['electron', '--remote-debugging-port=9311', `--user-data-dir=${firstProfilePath}`],
        env
      )
    ).toEqual({ cdpPort: 9311, userDataDir: firstProfilePath })
    expect(
      getChatboxQaLaunchArguments(
        ['electron', '--remote-debugging-port', '9312', '--user-data-dir', secondProfilePath],
        env
      )
    ).toEqual({ cdpPort: 9312, userDataDir: secondProfilePath })
  })

  it('preflights launch arguments and the manifest task root together', () => {
    const profilePath = path.join(tmpdir(), 'chatbox-profile')
    const taskRoot = path.join(tmpdir(), 'chatbox-qa', 'batch-01', 'task-a')
    const env = {
      CHATBOX_QA: '1',
      CHATBOX_QA_TASK_ID: 'batch-01-task-a',
      CHATBOX_QA_TASK_ROOT: taskRoot,
    }

    expect(
      getChatboxQaPreflight(['electron', '--remote-debugging-port=9311', `--user-data-dir=${profilePath}`], env)
    ).toMatchObject({
      launchArguments: { cdpPort: 9311, userDataDir: profilePath },
      paths: { taskRoot },
      runtime: { enabled: true, taskId: 'batch-01-task-a' },
    })
    expect(() => getChatboxQaPreflight(['electron'], env)).toThrow(/remote-debugging-port/)
  })

  it('derives isolated task paths from the task id by default', () => {
    expect(getChatboxQaPaths({ CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: 'task-01' })).toEqual({
      logsDir: path.join(tmpdir(), 'chatbox-qa', 'task-01', 'logs'),
      mainLogFile: path.join(tmpdir(), 'chatbox-qa', 'task-01', 'logs', 'main.log'),
      sandboxArtifactsRoot: path.join(tmpdir(), 'chatbox-qa', 'task-01', 'chatbox-sandbox', 'artifacts'),
      sandboxTmpRoot: path.join(tmpdir(), 'chatbox-qa', 'task-01', 'chatbox-sandbox', 'tmp'),
      taskRoot: path.join(tmpdir(), 'chatbox-qa', 'task-01'),
      tempDir: path.join(tmpdir(), 'chatbox-qa', 'task-01', 'tmp'),
    })
  })

  it('accepts the manifest batch/task layout independently from the correlation id', () => {
    const requestedTaskRoot = path.join(tmpdir(), 'chatbox-qa', 'batch-01', 'nested', '..', 'task-a')
    expect(
      getChatboxQaPaths({
        CHATBOX_QA: '1',
        CHATBOX_QA_TASK_ID: 'batch-01-task-a',
        CHATBOX_QA_TASK_ROOT: requestedTaskRoot,
      })
    ).toMatchObject({ taskRoot: path.resolve(requestedTaskRoot) })
  })

  it.each([
    'relative/task-01',
    path.join(tmpdir(), 'other-namespace', 'task-01'),
    path.join(tmpdir(), 'chatbox-qa'),
    path.join(tmpdir(), 'chatbox-qa', 'batch-01', 'task one'),
  ])('rejects an unsafe task root: %s', (taskRoot) => {
    expect(() =>
      getChatboxQaPaths({
        CHATBOX_QA: '1',
        CHATBOX_QA_TASK_ID: 'task-01',
        CHATBOX_QA_TASK_ROOT: taskRoot,
      })
    ).toThrow(/CHATBOX_QA_TASK_ROOT/)
  })
})

describe('getMainRuntimePolicy', () => {
  it('preserves current global integrations for a normal packaged build', () => {
    expect(getMainRuntimePolicy({}, { isHarmonyBuild: false, isPackaged: true })).toEqual({
      createTray: true,
      isQa: false,
      qaTaskId: null,
      registerGlobalShortcuts: true,
      registerProtocolClient: true,
      requestSingleInstanceLock: true,
      startAppUpdater: true,
    })
  })

  it('preserves development multi-instance behavior and Harmony updater behavior', () => {
    expect(getMainRuntimePolicy({}, { isHarmonyBuild: true, isPackaged: false })).toMatchObject({
      isQa: false,
      requestSingleInstanceLock: false,
      startAppUpdater: false,
    })
  })

  it('disables global integrations in QA mode', () => {
    expect(
      getMainRuntimePolicy(
        { CHATBOX_QA: '1', CHATBOX_QA_TASK_ID: '20260811_real-task-01' },
        { isHarmonyBuild: false, isPackaged: true }
      )
    ).toEqual({
      createTray: false,
      isQa: true,
      qaTaskId: '20260811_real-task-01',
      registerGlobalShortcuts: false,
      registerProtocolClient: false,
      requestSingleInstanceLock: false,
      startAppUpdater: false,
    })
  })
})
