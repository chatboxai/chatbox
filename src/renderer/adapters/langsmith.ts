import {
  createNoopLangSmithAdapter,
  type LangSmithAdapter,
  type LangSmithRunEndInput,
  type LangSmithRunStartInput,
} from '../../shared/utils/langsmith_adapter'

function hasElectronInvoke() {
  return typeof window !== 'undefined' && typeof window.electronAPI?.invoke === 'function'
}

export class RendererLangSmithAdapter implements LangSmithAdapter {
  public enabled = hasElectronInvoke()

  async startRun(input: LangSmithRunStartInput) {
    if (!hasElectronInvoke()) {
      return createNoopLangSmithAdapter().startRun(input)
    }

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

  async recordEvent(input: LangSmithRunStartInput & LangSmithRunEndInput) {
    if (!hasElectronInvoke()) {
      return
    }

    await window.electronAPI.invoke('langsmith:record-event', input)
  }
}

export const langsmith = new RendererLangSmithAdapter()
