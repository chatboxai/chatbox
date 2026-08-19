import { ChatboxAIAPIError } from '@shared/models/errors'
import { ANYSEARCH_DOMAINS } from '@shared/services/anysearch'
import { createWebSearchTool, WEB_SEARCH_TOOLSET_INSTRUCTION } from '@shared/web-search-tool'
import { jsonSchema, type ToolSet } from 'ai'
import type { JSONSchema7 } from 'json-schema'
import * as remote from '@/packages/remote'
import { getAnysearchProvider, getParseLinkProvider, webSearchExecutor } from '@/packages/web-search'
import type { AnysearchSearch } from '@/packages/web-search/anysearch'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'

const parseLinkDescription = `
## parse_link
Extract readable content from a specific URL — typically one the user shared or that a prior search returned.
`

const anysearchAdvancedDescription = `
## anysearch_get_sub_domains
Discover valid vertical sub-domains and their structured parameters before a vertical search.

## anysearch_search
Run a general or vertical Anysearch query. Before a vertical search, use anysearch_get_sub_domains and pass its routing key and required parameters without guessing.

## anysearch_batch_search
Run up to five general or discovered vertical searches in parallel. Use this for comparisons, multi-angle research, and hybrid general plus vertical searches.
`

export function getToolSetDescription(options: { includeParseLink: boolean; includeAnysearchAdvanced?: boolean }) {
  let description = WEB_SEARCH_TOOLSET_INSTRUCTION
  if (options.includeParseLink) description += parseLinkDescription
  if (options.includeAnysearchAdvanced) description += anysearchAdvancedDescription
  return description
}

// Tool definition shared with the native app; only the executor is renderer-specific.
export const webSearchTool: ToolSet[string] = createWebSearchTool(async (query, abortSignal) => {
  return await webSearchExecutor({ query }, { abortSignal })
})

const DEFAULT_PARSE_LINK_MAX_CHARS = 12_000

function buildParseLinkResult(params: { url: string; title: string; content: string; maxLength: number }) {
  const content = params.content.trim()
  const truncatedContent = content.slice(0, params.maxLength)
  return {
    url: params.url,
    title: params.title,
    content: truncatedContent,
    originalLength: content.length,
    truncated: content.length > truncatedContent.length,
  }
}

function formatParseLinkOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return `Error: ${error}`
  const title = stringField(record, 'title')
  const url = stringField(record, 'url')
  const content = stringField(record, 'content') ?? ''
  const originalLength = numberField(record, 'originalLength')
  const truncated = record?.truncated === true
  const header = [
    title ? `Title: ${title}` : undefined,
    url ? `URL: ${url}` : undefined,
    content ? 'Content:' : undefined,
  ]
    .filter(Boolean)
    .join('\n')
  const truncationHint =
    truncated && originalLength !== undefined
      ? `\n\n[Content truncated. Showing ${content.length} of ${originalLength} characters.]`
      : ''
  return `${header ? `${header}\n` : ''}${content}${truncationHint}`
}

export const parseLinkTool: ToolSet[string] = {
  description:
    'Parses the readable content of a web page. Use this when you need detailed information from a specific URL — typically one the user shared or that was returned by a prior search.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      url: {
        type: 'string',
        format: 'uri',
        description: 'The URL to parse. Always include the schema, e.g. https://example.com',
      },
      maxLength: {
        type: 'integer',
        minimum: 500,
        maximum: 50_000,
        description: 'Optional maximum number of characters to return from the parsed content.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  }),
  execute: async (input, { abortSignal }) => {
    const parseInput = input as { url: string; maxLength?: number }
    const maxLength = parseInput.maxLength ?? DEFAULT_PARSE_LINK_MAX_CHARS
    const normalizedMaxLength = Math.min(Math.max(maxLength, 500), 50_000)

    const searchProvider = settingActions.getExtensionSettings().webSearch.provider

    // Chatbox AI (build-in) path: licensed users use the authenticated parser; BYOK users fall back to free parser.
    if (searchProvider === 'build-in') {
      const licenseKey = settingActions.getLicenseKey()
      if (licenseKey) {
        const parsed = await remote.parseUserLinkPro({ licenseKey, url: parseInput.url, abortSignal })
        const storedContent = await platform.getStoreBlob(parsed.storageKey)
        if (storedContent == null) {
          const technical = `parse_link storage blob missing for URL ${parseInput.url} (storageKey: ${parsed.storageKey})`
          throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
        }
        return buildParseLinkResult({
          url: parseInput.url,
          title: parsed.title,
          content: storedContent,
          maxLength: normalizedMaxLength,
        })
      }

      const freeParsed = await remote.parseUserLinkFree({ url: parseInput.url })
      return buildParseLinkResult({
        url: parseInput.url,
        title: freeParsed.title,
        content: freeParsed.text,
        maxLength: normalizedMaxLength,
      })
    }

    // Third-party provider path (e.g. Tavily). Throws if API key missing or extraction fails.
    const provider = getParseLinkProvider()
    if (!provider) {
      const technical = `parse_link is not supported by the configured search provider "${searchProvider}"`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_not_supported') ?? new Error(technical)
    }
    const result = await provider.parseLink(parseInput.url, abortSignal)
    if (!result) {
      const technical = `parse_link returned no result for URL ${parseInput.url} (provider: ${searchProvider})`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }
    return buildParseLinkResult({
      url: result.url,
      title: result.title,
      content: result.content,
      maxLength: normalizedMaxLength,
    })
  },
  toModelOutput: toTextModelOutput(formatParseLinkOutput),
}

const anysearchSearchProperties: NonNullable<JSONSchema7['properties']> = {
  query: { type: 'string', minLength: 1, description: 'One natural-language search intent.' },
  domain: { type: 'string', enum: [...ANYSEARCH_DOMAINS] },
  sub_domain: { type: 'string', description: 'A routing key returned by anysearch_get_sub_domains.' },
  sub_domain_params: {
    type: 'object',
    additionalProperties: true,
    description: 'Structured parameters returned by anysearch_get_sub_domains. Include required keys even when empty.',
  },
  max_results: { type: 'integer', minimum: 1, maximum: 10 },
}

export const anysearchBatchSearchTool: ToolSet[string] = {
  description:
    'Runs 1 to 5 Anysearch queries in parallel. General queries omit domain fields. ' +
    'Vertical queries must use domain, sub_domain, and parameters returned by anysearch_get_sub_domains.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          properties: anysearchSearchProperties,
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    required: ['queries'],
    additionalProperties: false,
  }),
  execute: async (input, { abortSignal }) => {
    const provider = getAnysearchProvider()
    if (!provider) throw new Error('Anysearch is not the configured web search provider')
    return provider.batchSearch(
      (input as { queries: Array<{ query: string; domain?: (typeof ANYSEARCH_DOMAINS)[number] }> }).queries,
      abortSignal
    )
  },
  toModelOutput: toTextModelOutput(contentOrErrorText),
}

export const anysearchSearchTool: ToolSet[string] = {
  description:
    'Runs one Anysearch general or vertical search. Omit domain fields for general search. ' +
    'For vertical search, first call anysearch_get_sub_domains and use its exact routing key and required parameters.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: anysearchSearchProperties,
    required: ['query'],
    additionalProperties: false,
  }),
  execute: async (input, { abortSignal }) => {
    const provider = getAnysearchProvider()
    if (!provider) throw new Error('Anysearch is not the configured web search provider')
    return provider.searchAdvanced(input as Parameters<AnysearchSearch['searchAdvanced']>[0], abortSignal)
  },
  toModelOutput: toTextModelOutput(contentOrErrorText),
}

export const anysearchGetSubDomainsTool: ToolSet[string] = {
  description:
    'Returns valid Anysearch vertical sub-domains and their parameter schemas. ' +
    'Call this before using domain fields in a search.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      domains: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        uniqueItems: true,
        items: { type: 'string', enum: [...ANYSEARCH_DOMAINS] },
      },
    },
    required: ['domains'],
    additionalProperties: false,
  }),
  execute: async (input, { abortSignal }) => {
    const provider = getAnysearchProvider()
    if (!provider) throw new Error('Anysearch is not the configured web search provider')
    return provider.getSubDomains(
      (input as { domains: Array<(typeof ANYSEARCH_DOMAINS)[number]> }).domains,
      abortSignal
    )
  },
  toModelOutput: toTextModelOutput(contentOrErrorText),
}

export default {
  description: getToolSetDescription({ includeParseLink: true }),
  tools: {
    web_search: webSearchTool,
    parse_link: parseLinkTool,
    anysearch_batch_search: anysearchBatchSearchTool,
    anysearch_get_sub_domains: anysearchGetSubDomainsTool,
    anysearch_search: anysearchSearchTool,
  },
}
