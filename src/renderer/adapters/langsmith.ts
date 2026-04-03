import {
  createNoopLangSmithAdapter,
  type LangSmithAdapter,
  type LangSmithRunEndInput,
  type LangSmithRunStartInput,
} from '../../shared/utils/langsmith_adapter'
import {
  LANGSMITH_WEB_BRIDGE_ENDPOINTS,
  type LangSmithBridgeStartRunResponse,
} from '../../shared/utils/langsmith_bridge'
import { CHATBOX_BUILD_PLATFORM } from '../variables'

function hasElectronInvoke() {
  return typeof window !== 'undefined' && typeof window.electronAPI?.invoke === 'function'
}

function hasWebLangSmithBridge() {
  return CHATBOX_BUILD_PLATFORM === 'web' && typeof window !== 'undefined' && !hasElectronInvoke() && typeof fetch === 'function'
}

async function callWebLangSmithBridge<T>(path: string, payload: unknown) {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return null
    }

    return (await response.json()) as T
  } catch (error) {
    console.debug('LangSmith web bridge is unavailable.', error)
    return null
  }
}

export class RendererLangSmithAdapter implements LangSmithAdapter {
  public get enabled() {
    return hasElectronInvoke() || hasWebLangSmithBridge()
  }

  async startRun(input: LangSmithRunStartInput) {
    if (hasElectronInvoke()) {
      const result = await window.electronAPI.invoke('langsmith:start-run', input)
      return {
        runId: String(result.runId),
        end: async (endInput?: LangSmithRunEndInput) => {
          await window.electronAPI.invoke('langsmith:end-run', {
            runId: String(result.runId),
            result: endInput,
          })
        },
      }
    }

    if (!hasWebLangSmithBridge()) {
      return createNoopLangSmithAdapter().startRun(input)
    }

    const result = await callWebLangSmithBridge<LangSmithBridgeStartRunResponse>(
      LANGSMITH_WEB_BRIDGE_ENDPOINTS.startRun,
      input
    )
    if (!result?.enabled || !result.runId) {
      return createNoopLangSmithAdapter().startRun(input)
    }

    return {
      runId: String(result.runId),
      end: async (endInput?: LangSmithRunEndInput) => {
        await callWebLangSmithBridge(LANGSMITH_WEB_BRIDGE_ENDPOINTS.endRun, {
          runId: String(result.runId),
          result: endInput,
        })
      },
    }
  }

  async recordEvent(input: LangSmithRunStartInput & LangSmithRunEndInput) {
    if (hasElectronInvoke()) {
      await window.electronAPI.invoke('langsmith:record-event', input)
      return
    }

    if (!hasWebLangSmithBridge()) {
      return
    }

    await callWebLangSmithBridge(LANGSMITH_WEB_BRIDGE_ENDPOINTS.recordEvent, input)
  }
}

export const langsmith = new RendererLangSmithAdapter()
