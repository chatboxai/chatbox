// Keep this module free of Electron imports. main.ts loads it before any module
// that can read or mutate app.getPath('userData').
import { getChatboxQaPreflight } from './qa-runtime'

export const CHATBOX_QA_PREFLIGHT = getChatboxQaPreflight()
