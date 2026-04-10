import type { SearchResult } from '@shared/types'
import { webBrowsing } from '@/packages/remote'
import WebSearch from './base'

export class ChatboxSearch extends WebSearch {
  private licenseKey: string

  // Chatbox AI supports parse_link via the dedicated remote API.
  // The actual parse_link execution path lives in `parseLinkTool.execute` (build-in branch),
  // not in this class, because it requires a Pro license check that is policy-level.
  // This flag is informational and keeps PROVIDERS_WITH_PARSE_LINK consistent.
  override supportsParseLink = true

  constructor(licenseKey: string) {
    super()
    this.licenseKey = licenseKey
  }

  async search(query: string): Promise<SearchResult> {
    if (this.licenseKey) {
      const res = await webBrowsing({
        licenseKey: this.licenseKey,
        query,
      })

      return {
        items: res.links.map((link) => ({
          title: link.title,
          link: link.url,
          snippet: link.content,
        })),
      }
    } else {
      return {
        items: [],
      }
    }
  }
}
