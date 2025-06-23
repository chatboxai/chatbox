import WebSearch from './base'
import { SearchResult } from 'src/shared/types'

export class DuckDuckGoSearch extends WebSearch {
  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const html = await this.fetchSerp(query, signal)
    const items = this.extractItems(html)
    return { items }
  }

  private async fetchSerp(query: string, signal?: AbortSignal) {
    const html = await this.fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      body: new URLSearchParams({ q: query, df: 'y' }),
      signal,
    })
    return html as string
  }

  private extractItems(html: string) {
    // TODO: .zci-wrapper
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const nodes = dom.querySelectorAll('.results_links')
    return Array.from(nodes)
      .slice(0, 10)
      .map((node) => {
        const nodeA = node.querySelector('.result__a')!
        const link = nodeA.getAttribute('href')!
        const title = nodeA.textContent || ''
        const nodeAbstract = node.querySelector('.result__snippet')
        const snippet = nodeAbstract?.textContent || ''
        return { title, link, snippet }
      })
  }
}
