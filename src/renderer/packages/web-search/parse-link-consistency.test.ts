import { describe, expect, it } from 'vitest'
import { BingSearch } from '@/packages/web-search/bing'
import { BingNewsSearch } from '@/packages/web-search/bing-news'
import { BochaSearch } from '@/packages/web-search/bocha'
import { ChatboxSearch } from '@/packages/web-search/chatbox-search'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import { QueritSearch } from '@/packages/web-search/querit'
import { TavilySearch } from '@/packages/web-search/tavily'

/**
 * Validates that PROVIDERS_WITH_PARSE_LINK (the static set used for tool injection)
 * stays in sync with each provider's supportsParseLink flag (used at execution time
 * to find which configured provider handles parse_link).
 *
 * If you add parseLink support to a provider, update BOTH:
 *   1. Set `override supportsParseLink = true` on the provider class
 *   2. Add the provider id to PROVIDERS_WITH_PARSE_LINK in web-search/index.ts
 *
 * NOTE: This test maintains its own provider list because the project does not
 * yet have a central provider registry — `getSearchProviders()` uses a switch
 * statement keyed by provider id. Adding a new provider requires updating BOTH
 * `getSearchProviders()` AND this list. A future refactor could derive both from
 * a shared registry; tracked as follow-up.
 */
describe('parse_link capability consistency', () => {
  // Map of provider id (matching the union type used in extension settings)
  // to a freshly constructed instance with stub credentials.
  const providers: { id: string; instance: { supportsParseLink: boolean } }[] = [
    { id: 'build-in', instance: new ChatboxSearch('stub-license') },
    { id: 'bing', instance: new BingSearch() },
    { id: 'bing-news', instance: new BingNewsSearch() },
    { id: 'tavily', instance: new TavilySearch('stub-api-key') },
    { id: 'bocha', instance: new BochaSearch('stub-api-key') },
    { id: 'querit', instance: new QueritSearch('stub-api-key') },
  ]

  it.each(providers)('$id: PROVIDERS_WITH_PARSE_LINK matches supportsParseLink flag', ({ id, instance }) => {
    const inSet = PROVIDERS_WITH_PARSE_LINK.has(id)
    const flag = instance.supportsParseLink
    expect(inSet).toBe(flag)
  })

  it('PROVIDERS_WITH_PARSE_LINK only contains known provider ids', () => {
    const knownIds = new Set(providers.map((p) => p.id))
    for (const id of PROVIDERS_WITH_PARSE_LINK) {
      expect(knownIds.has(id)).toBe(true)
    }
  })
})
