import type { LanguageModelV4CallOptions, LanguageModelV4Middleware } from '@ai-sdk/provider'

type CallTool = NonNullable<LanguageModelV4CallOptions['tools']>[number]

function hasUnspecifiedStrict(tool: CallTool): boolean {
  return tool.type === 'function' && tool.strict == null
}

/**
 * The Responses API treats a function tool without `strict` as strict. Chatbox's
 * MCP, skill and built-in schemas are not written for strict mode, and the API then
 * ends the turn as `incomplete` (`max_output_tokens`) with no output. Default those
 * tools to non-strict; explicit `strict` values and provider-defined tools are kept.
 */
export const openAIResponsesToolStrictMiddleware: LanguageModelV4Middleware = {
  specificationVersion: 'v4',
  transformParams: ({ params }) => {
    if (!params.tools?.some(hasUnspecifiedStrict)) return Promise.resolve(params)
    return Promise.resolve({
      ...params,
      tools: params.tools.map((tool) => (hasUnspecifiedStrict(tool) ? { ...tool, strict: false } : tool)),
    })
  },
}
