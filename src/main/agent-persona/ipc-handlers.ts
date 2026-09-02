import { ipcMain } from 'electron'
import { scanLocalMemoryCandidates } from './local-memory-scanner'

export function registerAgentPersonaHandlers() {
  ipcMain.handle('agent-persona:scan-local-memories', () => scanLocalMemoryCandidates())
}
