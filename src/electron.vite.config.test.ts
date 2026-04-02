import { describe, expect, it } from 'vitest'
import electronViteConfig from '../electron.vite.config'

type RendererOptimizeDepsConfig = {
  main?: {
    build?: {
      rollupOptions?: {
        external?: string[]
      }
    }
  }
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

  it('keeps officeparser externalized in the main-process bundle', () => {
    const config =
      typeof electronViteConfig === 'function'
        ? electronViteConfig({ mode: 'production' } as never)
        : electronViteConfig

    const resolvedConfig = config as RendererOptimizeDepsConfig

    expect(resolvedConfig.main?.build?.rollupOptions?.external).toEqual(expect.arrayContaining(['officeparser']))
  })
})
