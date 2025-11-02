import { useState, useEffect } from 'react'
import { Settings, createSession, Session, Message } from './types'
import * as defaults from './defaults'
import * as openai from './openai-node'
import { v4 as uuidv4 } from 'uuid';
import { ThemeMode } from './theme';

// ipc

export const writeStore = (key: string, value: any) => {
    return (window as any).api.invoke('setStoreValue', key, value)
}
export const readStore = (key: string) => {
    return (window as any).api.invoke('getStoreValue', key)
}
export const getVersion = () => {
    return (window as any).api.invoke('getVersion')
}
export const openLink = (link: string) => {
    return (window as any).api.invoke('openLink', link)
}

export const shouldUseDarkColors = (): Promise<boolean> => {
    return api.invoke('shouldUseDarkColors');
};

// setting store

export function getDefaultSettings(): Settings {
    return {
        openaiKey: '',
        apiHost: 'https://api.openai.com',
        showWordCount: false,
        showTokenCount: false,
        theme: ThemeMode.System,
    }
}

export async function readSettings(): Promise<Settings> {
    const setting = await readStore('settings')
    if (!setting) {
        return getDefaultSettings()
    }
    // 兼容早期版本
    if (!setting.apiHost) {
        setting.apiHost = getDefaultSettings().apiHost
    }
    if (setting.showWordCount === undefined) {
        setting.showWordCount = getDefaultSettings().showWordCount
    }
    if (setting.showTokenCount === undefined) {
        setting.showTokenCount = getDefaultSettings().showTokenCount
    }
    if (setting.theme === undefined) {
        setting.theme = getDefaultSettings().theme;
    }
    return setting
}

export async function writeSettings(settings: Settings) {
    if (!settings.apiHost) {
        settings.apiHost = getDefaultSettings().apiHost
    }
    console.log('writeSettings.apiHost', settings.apiHost)
    openai.setHost(settings.apiHost)
    return writeStore('settings', settings)
}

// session store

export async function readSessions(): Promise<Session[]> {
    let sessions = await readStore('chat-sessions')
    if (!sessions) {
        return defaults.sessions
    }
    if (sessions.length === 0) {
        return [createSession()]
    }
    return sessions
}

export async function writeSessions(sessions: Session[]) {
    return writeStore('chat-sessions', sessions)
}

// react hook

export default function useStore() {
    const [version, _setVersion] = useState('unknown')
    useEffect(() => {
        getVersion().then((version: any) => {
            _setVersion(version)
        })
    }, [])

    const [settings, _setSettings] = useState<Settings>(getDefaultSettings())
    const [needSetting, setNeedSetting] = useState(false)
    useEffect(() => {
        readSettings().then((settings) => {
            _setSettings(settings)
            if (settings.openaiKey === '') {
                setNeedSetting(true)
            }
        })
    }, [])
    const setSettings = (settings: Settings) => {
        _setSettings(settings)
        writeSettings(settings)
    }

    const [chatSessions, _setChatSessions] = useState<Session[]>([createSession()])
    const [currentSession, switchCurrentSession] = useState<Session>(chatSessions[0])
    
    // Sync currentSession with chatSessions - if currentSession was deleted, switch to a valid one
    useEffect(() => {
        const currentExists = chatSessions.some(s => s.id === currentSession.id)
        if (!currentExists && chatSessions.length > 0) {
            // Current session was deleted, switch to first available session
            switchCurrentSession(chatSessions[0])
        }
    }, [chatSessions]) // Only depend on chatSessions to avoid infinite loop
    
    useEffect(() => {
        readSessions().then((sessions: Session[]) => {
            _setChatSessions(sessions)
            switchCurrentSession(sessions[0])
        })
    }, [])
    const setSessions = (sessions: Session[]) => {
        _setChatSessions(sessions)
        writeSessions(sessions)
    }

    const deleteChatSession = (target: Session) => {
        // Find the index of the session being deleted
        const deletedIndex = chatSessions.findIndex((s) => s.id === target.id)
        
        // Filter out the deleted session
        const sessions = chatSessions.filter((s) => s.id !== target.id)
        
        // Ensure there's at least one session
        if (sessions.length === 0) {
            sessions.push(createSession())
        }
        
        // Handle session switching based on what was deleted
        if (target.id === currentSession.id) {
            // Deleted session was active - navigate to a predictable location
            let nextSession: Session | null = null
            
            // Prefer the previous session (before the deleted one)
            if (deletedIndex > 0) {
                // The previous session is at deletedIndex - 1 in the original array
                const previousSessionId = chatSessions[deletedIndex - 1].id
                nextSession = sessions.find((s) => s.id === previousSessionId) || null
            }
            
            // If no previous session, try the next one
            if (!nextSession && deletedIndex < chatSessions.length - 1) {
                // The next session was at deletedIndex + 1 in the original array
                const nextSessionId = chatSessions[deletedIndex + 1].id
                nextSession = sessions.find((s) => s.id === nextSessionId) || null
            }
            
            // Fallback to first available session
            if (!nextSession) {
                nextSession = sessions[0]
            }
            
            // Ensure we have a valid session to switch to
            if (!nextSession) {
                // This should never happen since we ensure at least one session exists above
                console.error('No session to switch to after deletion')
                return
            }
            
            // Update sessions array and switch session - must happen synchronously
            // Switch first to immediately update currentSession, then update chatSessions
            switchCurrentSession(nextSession)
            _setChatSessions(sessions)
            writeSessions(sessions)
        } else {
            // Deleting a non-active session - stay on current session
            // Verify the current session still exists in the filtered array
            const currentSessionStillExists = sessions.some((s) => s.id === currentSession.id)
            if (currentSessionStillExists) {
                // Current session still exists - update sessions array and refresh currentSession reference
                // Get the updated session reference from the new array to ensure consistency
                const updatedCurrentSession = sessions.find((s) => s.id === currentSession.id)!
                _setChatSessions(sessions)
                writeSessions(sessions)
                // Update currentSession reference to match the new array (even though it's the same session)
                // This ensures we're always using a reference that exists in chatSessions
                switchCurrentSession(updatedCurrentSession)
            } else {
                // Edge case: current session was deleted somehow - shouldn't happen
                // Fallback to first available session
                switchCurrentSession(sessions[0])
                _setChatSessions(sessions)
                writeSessions(sessions)
            }
        }
    }
    const reorderSessions = (activeId: string, overId: string | null) => {
        if (!overId) return
        const oldIndex = chatSessions.findIndex(s => s.id === activeId)
        const newIndex = chatSessions.findIndex(s => s.id === overId)
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
        
        const newSessions = [...chatSessions]
        const [movedItem] = newSessions.splice(oldIndex, 1)
        newSessions.splice(newIndex, 0, movedItem)
        setSessions(newSessions)
    }
    const updateChatSession = (session: Session) => {
        // Check if the session exists in chatSessions - if not, it was deleted
        const sessionExists = chatSessions.some((s) => s.id === session.id)
        if (!sessionExists) {
            // Session doesn't exist - it was deleted, don't allow updates
            console.warn('Attempted to update deleted session:', session.id)
            return
        }
        
        const sessions = chatSessions.map((s) => {
            if (s.id === session.id) {
                return session
            }
            return s
        })
        setSessions(sessions)
        if (session.id === currentSession.id) {
            switchCurrentSession(session)
        }
    }
    const createChatSession = (session: Session, ix?: number) => {
        const sessions = [...chatSessions, session]
        setSessions(sessions)
        switchCurrentSession(session)
    }
    const createEmptyChatSession = () => {
        createChatSession(createSession())
    }

    const setMessages = (session: Session, messages: Message[]) => {
        updateChatSession({
            ...session,
            messages,
        })
    }

    const [toasts, _setToasts] = useState<{id: string, content: string}[]>([])
    const addToast = (content: string) => {
        const id = uuidv4()
        _setToasts([...toasts, {id, content}])
    }
    const removeToast = (id: string) => {
        _setToasts(toasts.filter((t) => t.id !== id))
    }

    return {
        version,

        settings,
        setSettings,
        needSetting,

        chatSessions,
        createChatSession,
        updateChatSession,
        deleteChatSession,
        createEmptyChatSession,
        reorderSessions,

        currentSession,
        switchCurrentSession,

        toasts,
        addToast,
        removeToast,
    }
}