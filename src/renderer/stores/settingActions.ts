import { getDefaultStore } from 'jotai'
import * as atoms from './atoms'
import * as defaults from '../../shared/defaults'
import { ModelProvider, Settings } from "../../shared/types";

export function modify(update: Partial<Settings>) {
    const store = getDefaultStore()
    store.set(atoms.settingsAtom, (settings) => ({
        ...settings,
        ...update,
    }))
}

export function needEditSetting() {
    const store = getDefaultStore()
    const settings = store.get(atoms.settingsAtom)
    if (settings.aiProvider === 'chatbox-ai' && !settings.licenseKey) {
        return true
    }
    if (
        settings.aiProvider === 'openai' &&
        settings.openaiKey === '' &&
        settings.apiHost === defaults.settings().apiHost
    ) {
        return true
    }
    if (settings.aiProvider === 'ollama' && !settings.ollamaModel) {
        return true
    }
    if (settings.aiProvider === ModelProvider.Flowise && !settings.flowiseChatflowId) {
        return true
    }
    return false
}

export function getLanguage() {
    const store = getDefaultStore()
    const settings = store.get(atoms.settingsAtom)
    return settings.language
}

export function getProxy() {
    const store = getDefaultStore()
    const settings = store.get(atoms.settingsAtom)
    return settings.proxy
}

export function getLicenseKey() {
    const store = getDefaultStore()
    const settings = store.get(atoms.settingsAtom)
    return settings.licenseKey
}

export function getAutoGenerateTitle() {
    const store = getDefaultStore()
    return store.get(atoms.autoGenerateTitleAtom)
}
