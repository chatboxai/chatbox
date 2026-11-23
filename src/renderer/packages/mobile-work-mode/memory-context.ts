import {
  buildMemoriesSection,
  captureChatMemorySnapshot,
  createMemoryToolContext,
  resolveSessionPromptContextSnapshot,
} from '@chatbox/core/application/memory'
import type { BasicGenerationToolPreparation, GenerationPreparationRequest } from '@chatbox/core/generation'
import type { SessionPromptContextSnapshot } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { combineMemoryStateTokens } from '@shared/types/agent-persona'
import { languageNameMap } from '@/i18n/locales'
import { buildAgentMemoryTools } from '@/packages/model-calls/toolsets/agent-memory'
import { buildMemorySearchTool, memorySearchInstructions } from '@/packages/model-calls/toolsets/memory-search'
import { getCopilotMemorySelection } from '@/stores/copilotStore'
import { rendererMemoryService } from '@/stores/memoryRuntime'

export async function prepareCapacitorMemoryContext(
  request: GenerationPreparationRequest<ModelDependencies>,
  persist: (snapshot: SessionPromptContextSnapshot) => void
): Promise<BasicGenerationToolPreparation> {
  const selection = await getCopilotMemorySelection(request.session.copilotId)
  const scope = selection.scope
  const enabled = scope.type === 'copilot' || request.globalSettings.memoryEnabled !== false
  const memoryStateToken = combineMemoryStateTokens(
    selection.memoryStateToken,
    scope.type === 'global' ? request.globalSettings.memoryStateToken : ''
  )
  const snapshot = await resolveSessionPromptContextSnapshot(
    {
      effectiveAgentMode: 'off',
      memoryEnabled: enabled,
      memoryStateToken,
      memoryScope: scope,
      settings: request.settings,
      messages: request.messages,
      targetMsgIx: request.targetMessageIndex,
      history: request.history,
      copilotId: request.session.copilotId,
      persist,
    },
    {
      listMemoriesForScope: (memoryScope) => rendererMemoryService.listMemoriesForScope(memoryScope),
      capture: (_directories, _mode, memoryScope) => captureChatMemorySnapshot(rendererMemoryService, memoryScope),
      matchesDirectories: () => true,
    }
  )
  const toolsAvailable = enabled && request.model.isSupportToolUse('agent')
  const memory = toolsAvailable
    ? buildAgentMemoryTools({ scope, languageName: languageNameMap[request.globalSettings.language] })
    : { tools: {}, description: '' }
  const tools = { ...memory.tools }
  if (request.globalSettings.memorySearchEnabled === true && request.model.isSupportToolUse()) {
    const currentUserMessageId = request.messages
      .slice(0, request.targetMessageIndex)
      .findLast((message) => message.role === 'user')?.id
    tools.memory_search = buildMemorySearchTool(request.session.id, currentUserMessageId)
  }
  const memories =
    enabled && snapshot ? buildMemoriesSection(snapshot.memories, { includeToolGuidance: toolsAvailable }) : ''
  return {
    tools,
    instructions: `${memories}${memory.description}${tools.memory_search ? memorySearchInstructions : ''}`,
    memoryToolContext: createMemoryToolContext(scope, enabled),
  }
}
