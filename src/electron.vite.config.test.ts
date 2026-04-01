import { describe, expect, it } from 'vitest'
import electronViteConfig from '../electron.vite.config'

type RendererOptimizeDepsConfig = {
  renderer?: {
    optimizeDeps?: {
      include?: string[]
    }
  }
}

describe('electron-vite renderer dependency optimization', () => {
  it('prebundles chatbridge runtime dependencies needed on cold dev starts', () => {
    const config =
      typeof electronViteConfig === 'function'
        ? electronViteConfig({ mode: 'development' } as never)
        : electronViteConfig

    const resolvedConfig = config as RendererOptimizeDepsConfig

    expect(resolvedConfig.renderer?.optimizeDeps?.include).toEqual(expect.arrayContaining(['mermaid', 'chess.js']))
  })
})
