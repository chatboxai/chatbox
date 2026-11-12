import { ModelProviderEnum } from '@shared/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GenericProviderRows } from './GenericProviderRows'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('./ModelRow', () => ({
  ModelRow: ({ detail }: { detail: { name: string } }) => <button>{detail.name}</button>,
}))
vi.mock('./ProviderRowHeader', () => ({
  ProviderRowHeader: ({ provider }: { provider: { name: string } }) => <header>{provider.name}</header>,
}))

const provider = { id: ModelProviderEnum.ChatboxAI, name: 'Chatbox AI' }
const model = { modelId: 'cached-chat', nickname: 'Cached Chat' }
const noop = () => undefined

function renderRows(favoriteOnly: boolean, hasChatboxCatalog: boolean, withByok = false) {
  return renderToStaticMarkup(
    <GenericProviderRows
      favoriteOnly={favoriteOnly}
      hasChatboxCatalog={hasChatboxCatalog}
      genericProviders={[
        { ...provider, models: [model] },
        ...(withByok ? [{ id: 'custom', name: 'Custom', models: [{ modelId: 'byok-chat' }] }] : []),
      ]}
      favoritedModels={[{ provider, model }]}
      collapsedProviders={{}}
      search=""
      isMobile={false}
      isFavorited={() => true}
      onToggleProvider={noop}
      onSelect={noop}
      onToggleFavorite={noop}
      onShowMobileDetail={noop}
      onDesktopDetailOpen={noop}
      onDesktopDetailClose={noop}
      onDisabledSelect={noop}
    />
  )
}

describe('Chatbox AI cached model rows', () => {
  it.each([false, true])('renders cached models without a catalog, favoriteOnly=%s', (favoriteOnly) => {
    const html = renderRows(favoriteOnly, false)
    expect(html).toContain('Cached Chat')
    expect(html).not.toContain('BYOK')
  })

  it.each([false, true])('leaves catalog-backed models to catalog rows, favoriteOnly=%s', (favoriteOnly) => {
    expect(renderRows(favoriteOnly, true)).not.toContain('Cached Chat')
  })

  it('places the BYOK section after cached Chatbox models', () => {
    const html = renderRows(false, false, true)
    expect(html.indexOf('Cached Chat')).toBeLessThan(html.indexOf('BYOK'))
    expect(html.indexOf('BYOK')).toBeLessThan(html.indexOf('byok-chat'))
  })
})
