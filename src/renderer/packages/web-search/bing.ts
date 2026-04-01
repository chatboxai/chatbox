import type { SearchResult } from '@shared/types'
import WebSearch from './base'

export class BingSearch extends WebSearch {
  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const html = await this.fetchSerp(query, signal)
    const items = this.extractItems(html)
    return { items }
  }

  private async fetchSerp(query: string, signal?: AbortSignal) {
    const html = await this.fetch('https://www.bing.com/search', {
      method: 'GET',
      query: { q: query },
      signal,
    })
    return html as string
  }

  private extractItems(html: string) {
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const nodes = dom.querySelectorAll('#b_results>li.b_algo')
    return Array.from(nodes)
      .slice(0, 10)
      .map((node) => {
        const nodeA = node.querySelector('h2>a') || node.querySelector('a.tilk')
        if (!nodeA) return null
        const link = nodeA.getAttribute('href')
        if (!link) return null
        const title = nodeA.getAttribute('aria-label') || nodeA.textContent || ''
        if (!title) return null
        const nodeAbstract = node.querySelector('p[class^="b_lineclamp"]') || node.querySelector('.b_caption p')
        const snippet = nodeAbstract?.textContent || ''
        return { title, link, snippet }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }
}
