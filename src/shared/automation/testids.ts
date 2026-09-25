/**
 * Stable automation surface for Chatbox UI.
 *
 * IDs describe user-facing semantics rather than component libraries, copy, or layout.
 * Dynamic domain identity belongs in adjacent data-* attributes (see
 * AutomationAdjacentAttr), never in a generated test ID. Removing or renaming
 * those attributes is a contract change, same as renaming a TestId.
 */

export const AUTOMATION_CONTRACT_ID = 'chatbox-ui'
export const AUTOMATION_CONTRACT_VERSION = '1.9.0'
export const AUTOMATION_CONTRACT_VERSION_ATTRIBUTE = 'data-automation-contract-version'

/** Adjacent identity attributes hosted on TestId elements. */
export const AutomationAdjacentAttr = {
  sessionId: 'data-session-id',
  folderId: 'data-folder-id',
  modelId: 'data-model-id',
  providerId: 'data-provider-id',
  shortcutName: 'data-shortcut-name',
  shortcutValue: 'data-shortcut-value',
} as const

/** Dynamic state attributes hosted on stable TestId elements. */
export const AutomationStateAttr = {
  actionBarArmed: 'data-automation-armed',
  sessionPinned: 'data-session-pinned',
} as const

export type AutomationReasoningLevel = 'default' | 'off' | 'low' | 'medium' | 'high'

export const TestId = {
  chat: {
    messageInput: 'message-input',
    send: 'message-send',
    stop: 'message-stop',
    attachmentMenuTrigger: 'attachment-menu-trigger',
    attachmentSelectImage: 'attachment-select-image',
    attachmentSelectFile: 'attachment-select-file',
    attachmentImageInput: 'attachment-image-input',
    attachmentFileInput: 'attachment-file-input',
    attachmentImagePreview: 'attachment-image-preview',
    webSearchToggle: 'web-search-toggle',
    queuedMessageEnqueue: 'queued-message-enqueue',
    queuedMessageBar: 'queued-message-bar',
    queuedMessageItem: 'queued-message-item',
    queuedMessageRemove: 'queued-message-remove',
    queuedMessageSteer: 'queued-message-steer',
    queuedMessageEdit: 'queued-message-edit',
    queuedMessageSendNow: 'queued-message-send-now',
    queuedMessageClear: 'queued-message-clear',
    queuedCompactionItem: 'queued-compaction-item',
    queuedCompactionRemove: 'queued-compaction-remove',
    contextMenuTrigger: 'context-menu-trigger',
    compressConversation: 'compress-conversation',
    compressConfirm: 'compress-confirm',
    newThread: 'new-thread-button',
    rollbackThread: 'rollback-thread-button',
    sessionSettings: 'session-settings-trigger',
  },
  model: {
    selectorTrigger: 'model-selector-trigger',
    selectorPanel: 'model-selector-panel',
    searchInput: 'model-search-input',
    /** Hosts AutomationAdjacentAttr.modelId. */
    option: 'model-option',
    optionName: 'model-option-name',
  },
  agent: {
    modeTrigger: 'agent-mode-trigger',
    modePanel: 'agent-mode-panel',
    modePanelBack: 'agent-mode-panel-back',
    modeChat: 'agent-mode-chat',
    modeWork: 'agent-mode-work',
    approvalStatusTrigger: 'agent-approval-status-trigger',
    approvalStatusMenu: 'agent-approval-status-menu',
    workingDirStatusTrigger: 'agent-working-dir-status-trigger',
    workingDirStatusMenu: 'agent-working-dir-status-menu',
  },
  reasoning: {
    trigger: 'reasoning-control-trigger',
    menu: 'reasoning-control-menu',
    level: (level: AutomationReasoningLevel) => `reasoning-level-${level}`,
  },
  layout: {
    titleBar: 'app-title-bar',
    expandSidebar: 'sidebar-expand',
  },
  sidebar: {
    root: 'sidebar',
    clearSessionList: 'clear-session-list-button',
    chatsSectionMenu: 'sidebar-chats-section-menu',
    newChat: 'new-chat-button',
    search: 'sidebar-search',
    newImage: 'new-image-button',
    downloadApp: 'download-app-button',
    settingsTrigger: 'settings-trigger',
    about: 'sidebar-about',
    /** Hosts AutomationAdjacentAttr.sessionId. */
    sessionItem: 'session-item',
    sessionTitle: 'session-title',
    sessionPin: 'session-pin',
    sessionArchive: 'session-archive',
    sessionMoveToFolder: 'session-move-to-folder',
    sessionSwitchHint: 'session-switch-hint',
    pinnedSection: 'sidebar-pinned-section',
    /** Hosts AutomationAdjacentAttr.folderId. */
    folderHeader: 'sidebar-folder-header',
    collapse: 'sidebar-collapse',
  },
  session: {
    searchInput: 'session-search-input',
    searchCurrent: 'session-search-current',
    searchAll: 'session-search-all',
    headerMenu: 'session-header-menu',
    headerMenuTrigger: 'session-header-menu-trigger',
    threadHistory: 'session-thread-history',
    threadHistoryDrawer: 'session-thread-history-drawer',
    export: 'session-export',
    duplicate: 'session-duplicate',
    widthToggle: 'session-width-toggle',
    clearMessages: 'session-clear-messages',
    clearMessagesConfirm: 'session-clear-messages-confirm',
    delete: 'session-delete',
    deleteConfirm: 'session-delete-confirm',
  },
  message: {
    item: 'message-item',
    content: 'message-content',
    actionBar: 'message-action-bar',
    actionMenu: 'message-action-menu',
    deleteConfirmation: 'message-delete-confirmation',
    actionBarRetry: 'message-action-bar-retry',
    actionBarRetryBelow: 'message-action-bar-retry-below',
    actionBarEdit: 'message-action-bar-edit',
    actionBarCopy: 'message-action-bar-copy',
    actionMenuRetry: 'message-action-menu-retry',
    actionMenuRetryBelow: 'message-action-menu-retry-below',
    actionMenuEdit: 'message-action-menu-edit',
    actionMenuCopy: 'message-action-menu-copy',
    actionMore: 'message-action-more',
    actionQuote: 'message-action-quote',
    actionDelete: 'message-action-delete',
    actionDeleteConfirm: 'message-action-delete-confirm',
    errorTips: 'message-error-tips',
    errorRetry: 'message-error-retry',
    threadLabel: 'thread-label',
    forkGroup: 'message-fork-group',
    forkPrevious: 'message-fork-previous',
    forkCounter: 'message-fork-counter',
    forkNext: 'message-fork-next',
    forkDelete: 'message-fork-delete',
    forkDeleteConfirm: 'message-fork-delete-confirm',
  },
  toolCall: {
    approve: 'tool-call-approve',
    continue: 'tool-call-continue',
    deny: 'tool-call-deny',
    dontAskAgain: 'tool-call-dont-ask-again',
    dontAskAgainSession: 'tool-call-dont-ask-again-session',
    dontAskAgainGlobal: 'tool-call-dont-ask-again-global',
    actionBar: 'tool-call-action-bar',
    actionBarView: 'tool-call-action-bar-view',
    actionBarProgress: 'tool-call-action-bar-progress',
    actionBarCountdown: 'tool-call-action-bar-countdown',
  },
  settings: {
    pauseOnToolCallLimitSwitch: 'settings-pause-on-tool-call-limit',
    sessionPauseOnToolCallLimitSwitch: 'session-settings-pause-on-tool-call-limit',
    providerList: 'settings-provider-list',
    /** Hosts AutomationAdjacentAttr.providerId. */
    providerItem: 'settings-provider-item',
    addProvider: 'settings-add-provider',
    addProviderName: 'settings-add-provider-name',
    addProviderApiMode: 'settings-add-provider-api-mode',
    addProviderSubmit: 'settings-add-provider-submit',
    providerName: 'settings-provider-name',
    providerApiMode: 'settings-provider-api-mode',
    providerApiKey: 'settings-provider-api-key',
    providerApiHost: 'settings-provider-api-host',
    providerApiPath: 'settings-provider-api-path',
    providerAzureEndpoint: 'settings-provider-azure-endpoint',
    providerAzureApiVersion: 'settings-provider-azure-api-version',
    providerCheck: 'settings-provider-check',
    providerDelete: 'settings-provider-delete',
    providerModelNew: 'settings-provider-model-new',
    providerModelReset: 'settings-provider-model-reset',
    providerModelFetch: 'settings-provider-model-fetch',
    providerModelList: 'settings-provider-model-list',
    /** Hosts AutomationAdjacentAttr.modelId. */
    providerModelItem: 'settings-provider-model-item',
    providerModelEdit: 'settings-provider-model-edit',
    providerModelDelete: 'settings-provider-model-delete',
    providerModelEditor: 'settings-provider-model-editor',
    providerModelEditorId: 'settings-provider-model-editor-id',
    providerModelEditorNickname: 'settings-provider-model-editor-nickname',
    providerModelEditorToolUse: 'settings-provider-model-editor-tool-use',
    providerModelEditorSave: 'settings-provider-model-editor-save',
    close: 'settings-close',
    navChat: 'settings-nav-chat',
    navGeneral: 'settings-nav-general',
    navDefaultModels: 'settings-nav-default-models',
    defaultPrompt: 'settings-default-prompt',
    temperature: 'settings-temperature',
    topP: 'settings-top-p',
    maxContext: 'settings-max-context',
    defaultChatModel: 'settings-default-chat-model',
    modelRigApplyPresets: 'settings-model-rig-apply-presets',
    modelRigTestAll: 'settings-model-rig-test-all',
    shortcutRow: 'settings-shortcut-row',
    shortcutSelect: 'settings-shortcut-select',
    sessionName: 'session-settings-name',
    sessionPrompt: 'session-settings-prompt',
    sessionTemperature: 'session-settings-temperature',
    sessionTopP: 'session-settings-top-p',
    sessionMaxTokens: 'session-settings-max-tokens',
    sessionMaxContext: 'session-settings-max-context',
    sessionClaudePromptCacheTTL: 'session-settings-claude-prompt-cache-ttl',
    sessionSave: 'session-settings-save',
    clearSessionListKeep: 'clear-session-list-keep-count',
    clearSessionListConfirm: 'clear-session-list-confirm',
  },
} as const

export const AutomationContract = {
  id: AUTOMATION_CONTRACT_ID,
  version: AUTOMATION_CONTRACT_VERSION,
  testIds: TestId,
} as const

export function listStaticTestIds(value: unknown = TestId): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function' || !value || typeof value !== 'object') return []
  return Object.values(value).flatMap((entry) => listStaticTestIds(entry))
}
