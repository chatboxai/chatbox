import { z } from 'zod'

export const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
})

export const PluginManifestSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  url: z.string(),
  description: z.string(),
  tools: z.array(ToolSchemaSchema),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  authRequired: z.boolean().default(false),
  authProvider: z.string().optional(),
})

export const BridgeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('register_tools'), schemas: z.array(ToolSchemaSchema) }),
  z.object({
    type: z.literal('tool_invoke'),
    toolCallId: z.string(),
    toolName: z.string(),
    params: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('tool_result'), toolCallId: z.string(), result: z.unknown() }),
  z.object({ type: z.literal('state_update'), state: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('completion'), result: z.unknown() }),
  z.object({ type: z.literal('auth_token'), token: z.string(), provider: z.string() }),
  z.object({ type: z.literal('oauth_request'), provider: z.string() }),
])

export type ToolSchema = z.infer<typeof ToolSchemaSchema>
export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>
