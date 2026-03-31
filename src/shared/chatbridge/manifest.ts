import { z } from 'zod'

const APP_ID_PATTERN = /^[a-z][a-z0-9-]*$/
const REVIEWER_ID_PATTERN = /^[a-z0-9._-]+$/i
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_:-]*$/i
const PERMISSION_ID_PATTERN = /^[a-z][a-z0-9._:-]*$/i
const HOST_CONTEXT_PATTERN = /^[a-z0-9._:-]+$/i

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function getOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
      continue
    }
    seen.add(value)
  }

  return Array.from(duplicates)
}

export const SUPPORTED_CHATBRIDGE_PROTOCOL_VERSION = 1

export const ChatBridgeProtocolVersionSchema = z.number().int().positive()
export type ChatBridgeProtocolVersion = z.infer<typeof ChatBridgeProtocolVersionSchema>

export const ChatBridgeAuthModeSchema = z.enum(['none', 'host-session', 'oauth', 'api-key'])
export type ChatBridgeAuthMode = z.infer<typeof ChatBridgeAuthModeSchema>
export const CHATBRIDGE_AUTH_MODES = [...ChatBridgeAuthModeSchema.options]

export const ChatBridgePermissionAccessSchema = z.enum(['read', 'write', 'execute'])
export type ChatBridgePermissionAccess = z.infer<typeof ChatBridgePermissionAccessSchema>

export const ChatBridgePermissionSchema = z
  .object({
    id: z.string().trim().regex(PERMISSION_ID_PATTERN),
    resource: z.string().trim().min(1),
    access: ChatBridgePermissionAccessSchema,
    required: z.boolean().default(true),
    purpose: z.string().trim().min(1),
  })
  .strict()
export type ChatBridgePermission = z.infer<typeof ChatBridgePermissionSchema>

export const ChatBridgeEventSchema = z.enum([
  'host.init',
  'host.invokeTool',
  'host.syncContext',
  'host.resume',
  'host.cancel',
  'app.ready',
  'app.state',
  'app.complete',
  'app.error',
  'app.requestAuth',
  'app.telemetry',
])
export type ChatBridgeEvent = z.infer<typeof ChatBridgeEventSchema>
export const CHATBRIDGE_EVENTS = [...ChatBridgeEventSchema.options]

export const ChatBridgeCompletionModeSchema = z.enum(['message', 'summary', 'state', 'handoff'])
export type ChatBridgeCompletionMode = z.infer<typeof ChatBridgeCompletionModeSchema>
export const CHATBRIDGE_COMPLETION_MODES = [...ChatBridgeCompletionModeSchema.options]

export const ChatBridgeJsonSchemaTypeSchema = z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array'])
export type ChatBridgeJsonSchemaType = z.infer<typeof ChatBridgeJsonSchemaTypeSchema>

type ChatBridgeJsonScalar = string | number | boolean | null

export interface ChatBridgeJsonSchema {
  type?: ChatBridgeJsonSchemaType
  description?: string
  properties?: Record<string, ChatBridgeJsonSchema>
  required?: string[]
  items?: ChatBridgeJsonSchema
  enum?: ChatBridgeJsonScalar[]
  additionalProperties?: boolean
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

const ChatBridgeJsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const ChatBridgeJsonSchemaSchema: z.ZodType<ChatBridgeJsonSchema> = z.lazy(() =>
  z
    .object({
      type: ChatBridgeJsonSchemaTypeSchema.optional(),
      description: z.string().trim().min(1).optional(),
      properties: z.record(z.string(), ChatBridgeJsonSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      items: ChatBridgeJsonSchemaSchema.optional(),
      enum: z.array(ChatBridgeJsonScalarSchema).min(1).optional(),
      additionalProperties: z.boolean().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minItems: z.number().int().nonnegative().optional(),
      maxItems: z.number().int().nonnegative().optional(),
    })
    .strict()
    .superRefine((schema, ctx) => {
      if (schema.type === 'object' && !schema.properties) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Object schemas must define properties',
          path: ['properties'],
        })
      }

      if (schema.type === 'array' && !schema.items) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Array schemas must define items',
          path: ['items'],
        })
      }

      if (schema.required && schema.required.length > 0) {
        const propertyKeys = new Set(Object.keys(schema.properties ?? {}))
        const missing = schema.required.filter((key) => !propertyKeys.has(key))
        if (missing.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Required keys must exist in properties: ${missing.join(', ')}`,
            path: ['required'],
          })
        }
      }

      if (
        typeof schema.minLength === 'number' &&
        typeof schema.maxLength === 'number' &&
        schema.minLength > schema.maxLength
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'minLength cannot exceed maxLength',
          path: ['minLength'],
        })
      }

      if (
        typeof schema.minimum === 'number' &&
        typeof schema.maximum === 'number' &&
        schema.minimum > schema.maximum
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'minimum cannot exceed maximum',
          path: ['minimum'],
        })
      }

      if (
        typeof schema.minItems === 'number' &&
        typeof schema.maxItems === 'number' &&
        schema.minItems > schema.maxItems
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'minItems cannot exceed maxItems',
          path: ['minItems'],
        })
      }
    })
)

export const ChatBridgeToolSchemaSchema = z
  .object({
    name: z.string().trim().regex(TOOL_NAME_PATTERN),
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1),
    schemaVersion: z.number().int().positive().default(1),
    inputSchema: ChatBridgeJsonSchemaSchema,
    outputSchema: ChatBridgeJsonSchemaSchema.optional(),
  })
  .strict()
  .superRefine((tool, ctx) => {
    if (tool.inputSchema.type !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tool input schemas must use an object root',
        path: ['inputSchema', 'type'],
      })
    }
  })
export type ChatBridgeToolSchema = z.infer<typeof ChatBridgeToolSchemaSchema>

export const ChatBridgeTimeoutsSchema = z
  .object({
    launchMs: z.number().int().positive(),
    idleMs: z.number().int().positive(),
    completionMs: z.number().int().positive(),
  })
  .strict()
export type ChatBridgeTimeouts = z.infer<typeof ChatBridgeTimeoutsSchema>

export const ChatBridgeSafetyMetadataSchema = z
  .object({
    reviewed: z.literal(true),
    sandbox: z.enum(['hosted-iframe', 'native-shell']),
    handlesStudentData: z.boolean(),
    requiresTeacherApproval: z.boolean().default(false),
  })
  .strict()
export type ChatBridgeSafetyMetadata = z.infer<typeof ChatBridgeSafetyMetadataSchema>

export const ChatBridgeTenantAvailabilitySchema = z
  .object({
    default: z.enum(['enabled', 'disabled']),
    allow: z.array(z.string().trim().regex(HOST_CONTEXT_PATTERN)).default([]),
    deny: z.array(z.string().trim().regex(HOST_CONTEXT_PATTERN)).default([]),
  })
  .strict()
export type ChatBridgeTenantAvailability = z.infer<typeof ChatBridgeTenantAvailabilitySchema>

export const ChatBridgeHealthcheckSchema = z
  .object({
    url: z
      .string()
      .trim()
      .url()
      .refine((value) => isHttpsUrl(value), 'Healthcheck URL must use https'),
    intervalMs: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict()
export type ChatBridgeHealthcheck = z.infer<typeof ChatBridgeHealthcheckSchema>

export const ReviewedAppManifestSchema = z
  .object({
    appId: z.string().trim().regex(APP_ID_PATTERN),
    name: z.string().trim().min(1),
    version: z.string().trim().regex(SEMVER_PATTERN),
    protocolVersion: ChatBridgeProtocolVersionSchema,
    origin: z
      .string()
      .trim()
      .url()
      .refine((value) => isHttpsUrl(value), 'Origin must use https'),
    uiEntry: z
      .string()
      .trim()
      .url()
      .refine((value) => isHttpsUrl(value), 'UI entry must use https'),
    authMode: ChatBridgeAuthModeSchema,
    permissions: z.array(ChatBridgePermissionSchema),
    toolSchemas: z.array(ChatBridgeToolSchemaSchema),
    supportedEvents: z.array(ChatBridgeEventSchema).min(1),
    completionModes: z.array(ChatBridgeCompletionModeSchema).min(1),
    timeouts: ChatBridgeTimeoutsSchema,
    safetyMetadata: ChatBridgeSafetyMetadataSchema,
    tenantAvailability: ChatBridgeTenantAvailabilitySchema,
    healthcheck: ChatBridgeHealthcheckSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (getOrigin(manifest.uiEntry) !== manifest.origin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'uiEntry must match manifest origin',
        path: ['uiEntry'],
      })
    }

    if (manifest.healthcheck && getOrigin(manifest.healthcheck.url) !== manifest.origin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'healthcheck URL must match manifest origin',
        path: ['healthcheck', 'url'],
      })
    }

    const duplicatePermissionIds = findDuplicates(manifest.permissions.map((permission) => permission.id))
    if (duplicatePermissionIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Permission ids must be unique: ${duplicatePermissionIds.join(', ')}`,
        path: ['permissions'],
      })
    }

    const duplicateToolNames = findDuplicates(manifest.toolSchemas.map((tool) => tool.name))
    if (duplicateToolNames.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tool names must be unique: ${duplicateToolNames.join(', ')}`,
        path: ['toolSchemas'],
      })
    }
  })
export type ReviewedAppManifest = z.infer<typeof ReviewedAppManifestSchema>

export const ReviewedAppApprovalSchema = z
  .object({
    status: z.literal('approved'),
    reviewedAt: z.number().int().nonnegative(),
    reviewedBy: z.string().trim().regex(REVIEWER_ID_PATTERN),
    catalogVersion: z.number().int().positive(),
  })
  .strict()
export type ReviewedAppApproval = z.infer<typeof ReviewedAppApprovalSchema>

export const ReviewedAppCatalogEntrySchema = z
  .object({
    manifest: ReviewedAppManifestSchema,
    approval: ReviewedAppApprovalSchema,
  })
  .strict()
export type ReviewedAppCatalogEntry = z.infer<typeof ReviewedAppCatalogEntrySchema>
