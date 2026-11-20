import { MantineProvider } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GLASS_BAR_CLASS, GLASS_SURFACE_CLASS } from '@/lib/glass-surface'
import {
  CARD_SURFACE_STYLE,
  DRAWER_SURFACE_STYLE,
  getModelSelectorFloatingSurfaceClass,
  MODEL_SELECTOR_SURFACE_CLASS,
} from './constants'
import { ProviderRowHeader } from './ProviderRowHeader'

vi.mock('../icons/ProviderIcon', () => ({ default: () => null }))

const classesOf = (value: string) => value.split(/\s+/)

describe('model selector glass surfaces', () => {
  it('blurs only the floating desktop panel and detail card; on mobile the drawer itself is the surface', () => {
    expect(classesOf(getModelSelectorFloatingSurfaceClass(false))).toContain(GLASS_SURFACE_CLASS)
    expect(classesOf(getModelSelectorFloatingSurfaceClass(false))).toContain('bg-chatbox-background-primary')
    expect(getModelSelectorFloatingSurfaceClass(true)).not.toContain(GLASS_SURFACE_CLASS)
    expect(getModelSelectorFloatingSurfaceClass(true)).not.toContain('bg-')
  })

  it('keeps the inner surface fill free of a second glass layer', () => {
    expect(classesOf(MODEL_SELECTOR_SURFACE_CLASS)).not.toContain(GLASS_SURFACE_CLASS)
  })

  it('leaves the fill to classes so the wallpaper rules can replace it', () => {
    expect(DRAWER_SURFACE_STYLE).not.toHaveProperty('background')
    expect(DRAWER_SURFACE_STYLE).not.toHaveProperty('backgroundColor')
    expect(CARD_SURFACE_STYLE).not.toHaveProperty('background')
    expect(CARD_SURFACE_STYLE).not.toHaveProperty('backgroundColor')
  })

  it('gives the sticky Chatbox AI header a plain bar fill and generic headers no fill of their own', () => {
    const provider = { id: ModelProviderEnum.ChatboxAI, name: 'Chatbox AI' }
    const header = (variant: 'chatbox' | 'generic') =>
      renderToStaticMarkup(
        <MantineProvider>
          <ProviderRowHeader
            provider={provider}
            modelCount={1}
            collapsed={false}
            variant={variant}
            onToggle={() => {}}
          />
        </MantineProvider>
      )
    const sticky = header('chatbox')
    const generic = header('generic')
    expect(sticky).toContain(GLASS_BAR_CLASS)
    expect(sticky).not.toContain(GLASS_SURFACE_CLASS)
    expect(generic).not.toContain(GLASS_SURFACE_CLASS)
    expect(generic).not.toContain('bg-chatbox-background-primary')
  })
})
