import WebSearch from './base'
import { SearchResult } from '@/../shared/types'

export class BingNewsSearch extends WebSearch {
  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const html = await this.fetchSerp(query, signal)
    const items = this.extractItems(html)
    return { items }
  }

  private async fetchSerp(query: string, signal?: AbortSignal) {
    const html = await this.fetch('https://www.bing.com/news/infinitescrollajax', {
      method: 'GET',
      query: { InfiniteScroll: '1', q: query },
      signal,
    })
    return html as string
  }

  private extractItems(html: string) {
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const nodes = dom.querySelectorAll('.newsitem')
    return Array.from(nodes)
      .slice(0, 10)
      .map((node) => {
        const nodeA = node.querySelector('.title')!
        const link = nodeA.getAttribute('href')!
        const title = nodeA.textContent || ''
        const nodeAbstract = node.querySelector('.snippet')
        const snippet = nodeAbstract?.textContent || ''
        return { title, link, snippet }
      })
  }
}
