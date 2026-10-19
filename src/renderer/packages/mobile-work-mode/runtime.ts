import {
  BasicGenerationPreparation,
  type BasicGenerationToolPreparation,
  type GenerationPreparationRequest,
} from '@chatbox/core/generation'
import { throwIfWorkAborted } from '@shared/mobile-work/abort'
import { LocalWorkMode, WORK_INSTRUCTIONS } from '@shared/mobile-work/LocalWorkMode'
import { workModelDisclosure } from '@shared/mobile-work/model-disclosure'
import { buildLocalViewImage } from '@shared/mobile-work/view-image'
import type { ModelInterface } from '@shared/models/types'
import { supportsToolResultImages } from '@shared/tools/view-image'
import type { ModelDependencies } from '@shared/types/adapters'
import type { ToolSet } from 'ai'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { rendererApplication } from '@/app/renderer-application'
import { prepareMobileMCPTools } from '@/packages/mcp/mobile-tools'
import { parseLinkTool, webSearchTool } from '@/packages/model-calls/toolsets/web-search'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'
import { CapacitorWorkspace } from './CapacitorWorkspace'
import { createCapacitorSystemToolGroups } from './capacitor-system-tools'
import { capacitorDocumentParser } from './document-parser'
import { capacitorExecution } from './execution-service'
import { normalizeWorkImage } from './normalize-work-image'

export const capacitorWorkspace = new CapacitorWorkspace()
export const capacitorWorkMode = new LocalWorkMode(
  capacitorWorkspace,
  capacitorExecution,
  (context) =>
    createCapacitorSystemToolGroups({
      sessionId: context.sessionId,
      providerLabel: context.modelName,
      providerIdentity: context.modelIdentity,
      signal: context.signal,
      workspace: capacitorWorkspace,
    }),
  currentBlobStorage,
  () => ({
    getSettings: () => settingsStore.getState().getSettings(),
    refreshAccount: async () => {
      const { refreshChatboxAccount } = await import('@/packages/chatbox-cli/account')
      return Boolean((await refreshChatboxAccount()).refreshed)
    },
    getVersion: async () => ({ installedVersion: await platform.getVersion(), platform: await platform.getPlatform() }),
    listChats: (cursor, limit, archived) =>
      archived
        ? rendererApplication.sessions.listArchivedSessionsMetaPage(cursor, limit)
        : rendererApplication.sessions.listSessionsMetaPage(cursor, limit),
    readChatPage: (request) => rendererApplication.sessions.readSessionTranscriptWindow(request),
  }),
  capacitorDocumentParser
)

export function buildMobileWebTools(model: ModelInterface, enabled: boolean) {
  const tools: ToolSet = {}
  if (!enabled || !model.isSupportToolUse('web-browsing')) return { tools }
  const includeParseLink = PROVIDERS_WITH_PARSE_LINK.has(settingActions.getExtensionSettings().webSearch.provider)
  tools.web_search = webSearchTool
  if (includeParseLink) tools.parse_link = parseLinkTool
  return { tools }
}

export function capacitorImageTools(model: ModelInterface, sessionId: string, signal: AbortSignal) {
  return model.isSupportVision()
    ? buildLocalViewImage({
        workspace: capacitorWorkspace,
        blobs: currentBlobStorage,
        sessionId,
        signal,
        normalize: normalizeWorkImage,
        toolResultImages: supportsToolResultImages(model.apiStyle),
      })
    : undefined
}

export async function prepareCapacitorWorkMode(
  request: GenerationPreparationRequest<ModelDependencies>,
  memory: BasicGenerationToolPreparation
) {
  throwIfWorkAborted(request.signal)
  await capacitorWorkspace.seed(
    request.session.id,
    request.messages.slice(0, request.targetMessageIndex),
    currentBlobStorage
  )
  throwIfWorkAborted(request.signal)
  const mcp = await prepareMobileMCPTools({
    enabled: true,
    model: request.model,
    settings: request.globalSettings,
    signal: request.signal,
  })
  const web = buildMobileWebTools(request.model, request.webBrowsing)
  const images = capacitorImageTools(request.model, request.session.id, request.signal)
  const { tools, active } = await capacitorWorkMode.createTools(
    {
      sessionId: request.session.id,
      capabilities: request.settings.localWorkCapabilities,
      skillPreferences: request.globalSettings.mobileSkillPreferences,
      ...workModelDisclosure(request.settings, request.globalSettings),
      signal: request.signal,
    },
    { ...web.tools, ...images?.tools, ...memory.tools, ...mcp.tools }
  )
  const prepared = await new BasicGenerationPreparation<ModelDependencies>({
    prepareTools: async () => ({
      ...memory,
      tools,
      instructions: `${memory.instructions ?? ''}${WORK_INSTRUCTIONS}${mcp.unavailable.length ? '\nSome enabled MCP services are unavailable. Do not claim to have used their tools.' : ''}`,
    }),
  }).prepare(request)
  return {
    ...prepared,
    chatOptions: {
      ...prepared.chatOptions,
      agentMode: true,
      prepareStep: async ({ messages }: { messages: import('ai').ModelMessage[] }) => ({
        activeTools: [...active],
        ...(images ? { messages: await images.prepareStepMessages(messages) } : {}),
      }),
    },
  }
}
