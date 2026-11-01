export const QueryKeys = {
  ChatSessionsList: ['chat-sessions-list'],
  ArchivedChatSessionsList: ['archived-chat-sessions-list'],
  SessionFolders: ['session-folders'],
  ChatSessionHeader: (id: string) => ['chat-session-header', id],
  ChatSessionMessage: (id: string, messageId?: string) =>
    messageId ? ['chat-session-message', id, messageId] : ['chat-session-message', id],
  ChatSessionThread: (id: string, threadId?: string) =>
    threadId ? ['chat-session-thread', id, threadId] : ['chat-session-thread', id],
  ChatSessionThreads: (id: string) => ['chat-session-threads', id],
  ChatSessionForks: (id: string, pivotId?: string) =>
    pivotId ? ['chat-session-forks', id, pivotId] : ['chat-session-forks', id],
  ChatSessionSettings: (id: string) => ['chat-session-settings', id],
}
