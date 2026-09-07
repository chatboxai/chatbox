/**
 * Minimal ambient types for `jsdom`, which ships no declarations and has no
 * @types package installed. Only the surface used by tests is declared; extend
 * it here rather than widening to `any`.
 */
declare module 'jsdom' {
  export interface JSDOMOptions {
    runScripts?: 'dangerously' | 'outside-only'
    url?: string
    pretendToBeVisual?: boolean
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions)
    readonly window: Window & typeof globalThis
  }
}
