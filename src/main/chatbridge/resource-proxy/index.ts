import type { ChatBridgeCredentialHandleValidationResult } from '@shared/chatbridge/auth'
import {
  CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
  type ChatBridgeResourceProxyAction,
  ChatBridgeResourceProxyActionSchema,
  type ChatBridgeResourceProxyAuditEntry,
  ChatBridgeResourceProxyAuditEntrySchema,
  ChatBridgeResourceProxyRequestSchema,
  ChatBridgeResourceProxyResponseSchema,
  type ChatBridgeResourceProxyResponse,
} from '@shared/chatbridge/resource-proxy'
import { type ChatBridgeAuditCapture, resolveChatBridgeAuditRecordFields } from '@shared/chatbridge/audit'

export interface ChatBridgeResourceHandleValidator {
  authorizeResourceAccess(input: {
    handleId: string
    userId: string
    appId: string
    permissionIds?: string[]
  }): ChatBridgeCredentialHandleValidationResult
}

export interface ChatBridgeRegisteredResourceAction extends ChatBridgeResourceProxyAction {
  appId: string
}

type ChatBridgeResourceHandler = (input: {
  payload: Record<string, unknown>
  request: ReturnType<typeof ChatBridgeResourceProxyRequestSchema.parse>
}) => Promise<Record<string, unknown>> | Record<string, unknown>

type CreateChatBridgeResourceProxyOptions = {
  validator: ChatBridgeResourceHandleValidator
  now?: () => number
  onAudit?: (entry: ChatBridgeResourceProxyAuditEntry) => void
  auditCapture?: ChatBridgeAuditCapture
}

function createAuditEntry(input: {
  request: ReturnType<typeof ChatBridgeResourceProxyRequestSchema.parse>
  action?: ChatBridgeRegisteredResourceAction
  outcome: ChatBridgeResourceProxyAuditEntry['outcome']
  loggedAt: number
  details?: string[]
  capture?: ChatBridgeAuditCapture
}) {
  const auditFields = resolveChatBridgeAuditRecordFields({
    details: input.details,
    payload: input.request.payload,
    capture: input.capture,
  })

  return ChatBridgeResourceProxyAuditEntrySchema.parse({
    schemaVersion: CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
    category: 'resource.action',
    requestId: input.request.requestId,
    handleId: input.request.handleId,
    userId: input.request.userId,
    appId: input.request.appId,
    resource: input.request.resource,
    action: input.request.action,
    permissionId: input.action?.permissionId,
    outcome: input.outcome,
    loggedAt: input.loggedAt,
    ...auditFields,
  })
}

function createActionKey(appId: string, resource: string, action: string) {
  return `${appId}::${resource}::${action}`
}

export function createChatBridgeResourceProxy(options: CreateChatBridgeResourceProxyOptions) {
  const now = () => options.now?.() ?? Date.now()
  const actionRegistry = new Map<string, { action: ChatBridgeRegisteredResourceAction; handler: ChatBridgeResourceHandler }>()

  function emitAudit(entry: ChatBridgeResourceProxyAuditEntry) {
    options.onAudit?.(entry)
  }

  return {
    registerAction(actionInput: ChatBridgeRegisteredResourceAction, handler: ChatBridgeResourceHandler) {
      const action = ChatBridgeResourceProxyActionSchema.extend({
        appId: ChatBridgeResourceProxyRequestSchema.shape.appId,
      }).parse(actionInput)

      actionRegistry.set(createActionKey(action.appId, action.resource, action.action), {
        action,
        handler,
      })

      return action
    },
    async execute(requestInput: unknown): Promise<ChatBridgeResourceProxyResponse> {
      const parsedRequest = ChatBridgeResourceProxyRequestSchema.safeParse(requestInput)
      if (!parsedRequest.success) {
        const requestId =
          typeof requestInput === 'object' && requestInput !== null && 'requestId' in requestInput
            ? String((requestInput as { requestId?: unknown }).requestId)
            : 'invalid-request'
        const resource =
          typeof requestInput === 'object' && requestInput !== null && 'resource' in requestInput
            ? String((requestInput as { resource?: unknown }).resource)
            : 'unknown-resource'
        const action =
          typeof requestInput === 'object' && requestInput !== null && 'action' in requestInput
            ? String((requestInput as { action?: unknown }).action)
            : 'unknown-action'
        const invalidPayload =
          typeof requestInput === 'object' &&
          requestInput !== null &&
          'payload' in requestInput &&
          typeof (requestInput as { payload?: unknown }).payload === 'object' &&
          (requestInput as { payload?: unknown }).payload !== null &&
          !Array.isArray((requestInput as { payload?: unknown }).payload)
            ? ((requestInput as { payload: Record<string, unknown> }).payload as Record<string, unknown>)
            : undefined
        const auditFields = resolveChatBridgeAuditRecordFields({
          details: parsedRequest.error.issues.map((issue) => issue.message),
          payload: invalidPayload,
          capture: options.auditCapture,
        })

        return ChatBridgeResourceProxyResponseSchema.parse({
          schemaVersion: CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
          requestId,
          status: 'error',
          resource,
          action,
          result: {},
          errorCode: 'unsupported-action',
          message: 'Resource proxy request failed validation.',
          audit: {
            schemaVersion: CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
            category: 'resource.action',
            requestId,
            handleId:
              typeof requestInput === 'object' && requestInput !== null && 'handleId' in requestInput
                ? String((requestInput as { handleId?: unknown }).handleId)
                : 'invalid-handle',
            userId:
              typeof requestInput === 'object' && requestInput !== null && 'userId' in requestInput
                ? String((requestInput as { userId?: unknown }).userId)
                : 'unknown-user',
            appId:
              typeof requestInput === 'object' && requestInput !== null && 'appId' in requestInput
                ? String((requestInput as { appId?: unknown }).appId)
                : 'unknown-app',
            resource,
            action,
            outcome: 'error',
            loggedAt: now(),
            ...auditFields,
          },
        })
      }

      const request = parsedRequest.data
      const registered = actionRegistry.get(createActionKey(request.appId, request.resource, request.action))

      if (!registered) {
        const audit = createAuditEntry({
          request,
          outcome: 'denied',
          loggedAt: now(),
          details: ['Requested resource action is not registered for this reviewed app.'],
          capture: options.auditCapture,
        })
        emitAudit(audit)
        return ChatBridgeResourceProxyResponseSchema.parse({
          schemaVersion: CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
          requestId: request.requestId,
          status: 'denied',
          resource: request.resource,
          action: request.action,
          result: {},
          errorCode: 'unsupported-action',
          message: 'Requested resource action is not approved.',
          audit,
        })
      }

      const validation = options.validator.authorizeResourceAccess({
        handleId: request.handleId,
        userId: request.userId,
        appId: request.appId,
        permissionIds: [registered.action.permissionId],
      })

      if (!validation.valid) {
        const audit = createAuditEntry({
          request,
          action: registered.action,
          outcome: 'denied',
          loggedAt: now(),
          details: validation.details,
          capture: options.auditCapture,
        })
        emitAudit(audit)
        return ChatBridgeResourceProxyResponseSchema.parse({
          schemaVersion: CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
          requestId: request.requestId,
          status: 'denied',
          resource: request.resource,
          action: request.action,
          result: {},
          errorCode: validation.code,
          message: 'Credential handle authorization failed for this resource action.',
          audit,
        })
      }

      try {
        const result = await registered.handler({
          payload: request.payload,
          request,
        })
        const audit = createAuditEntry({
          request,
          action: registered.action,
          outcome: 'granted',
          loggedAt: now(),
          capture: options.auditCapture,
        })
        emitAudit(audit)
        return ChatBridgeResourceProxyResponseSchema.parse({
          schemaVersion: CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
          requestId: request.requestId,
          status: 'success',
          resource: request.resource,
          action: request.action,
          result,
          message: 'Resource action completed through the host-mediated proxy.',
          audit,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown resource proxy error'
        const audit = createAuditEntry({
          request,
          action: registered.action,
          outcome: 'error',
          loggedAt: now(),
          details: [message],
          capture: options.auditCapture,
        })
        emitAudit(audit)
        return ChatBridgeResourceProxyResponseSchema.parse({
          schemaVersion: CHATBRIDGE_RESOURCE_PROXY_SCHEMA_VERSION,
          requestId: request.requestId,
          status: 'error',
          resource: request.resource,
          action: request.action,
          result: {},
          errorCode: 'handler-error',
          message,
          audit,
        })
      }
    },
    getRegisteredActions() {
      return Array.from(actionRegistry.values()).map(({ action }) => action)
    },
  }
}
