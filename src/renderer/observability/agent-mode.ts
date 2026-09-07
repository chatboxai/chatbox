import * as Sentry from '@sentry/react'
import { isExpectedGenerationError } from '@shared/models/error-classification'
import { normalizeErrorForSentry } from '@shared/utils/sentry_policy'
import { toBooleanString } from '@/analytics/values'

function sanitizeProviderTag(provider: string): string {
  return provider.startsWith('custom-provider-') ? 'custom' : provider
}

function sanitizeToolNameTag(toolName: string): string {
  const parts = toolName.split('__')
  return parts[0] === 'mcp' && parts.length >= 3 ? `mcp__${parts.slice(2).join('__')}` : toolName
}

export function captureAgentModeException(
  error: unknown,
  context: {
    operation:
      | 'suggestion'
      | 'suggestion_model'
      | 'generation'
      | 'tool_pause_continue'
      | 'tool_retry'
      | 'full_access_bypass'
    provider?: string
    model?: string
    agentMode?: string
    fullAccess?: boolean
    toolName?: string
    pauseType?: string
    operationType?: string
  }
) {
  if (isExpectedGenerationError(error)) return
  const exception = normalizeErrorForSentry(error)
  const customProvider = context.provider?.startsWith('custom-provider-') === true
  Sentry.withScope((scope) => {
    scope.setTag('component', 'agent-mode')
    scope.setTag('operation', context.operation)
    scope.setTag('error_domain', 'agent-mode')
    scope.setTag('error_operation', context.operation)
    scope.setTag('error_priority', 'high')
    scope.setTag('error_handled', 'true')
    if (context.provider) scope.setTag('provider', sanitizeProviderTag(context.provider))
    if (context.model && !customProvider) scope.setTag('model', context.model)
    if (context.agentMode) scope.setTag('agent_mode', context.agentMode)
    if (context.fullAccess !== undefined) scope.setTag('full_access', toBooleanString(context.fullAccess))
    if (context.toolName) scope.setTag('tool_name', sanitizeToolNameTag(context.toolName))
    if (context.pauseType) scope.setTag('pause_type', context.pauseType)
    if (context.operationType) scope.setTag('operation_type', context.operationType)
    Sentry.captureException(exception)
  })
}
