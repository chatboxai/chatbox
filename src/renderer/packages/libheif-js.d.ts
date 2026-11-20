// Type declarations for libheif-js (ships plain CommonJS + inlined wasm, no types).
declare module 'libheif-js' {
  export interface HeifDecodedImage {
    get_width(): number
    get_height(): number
    is_primary(): boolean
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result?: { data: Uint8ClampedArray; width: number; height: number } | null) => void
    ): void
  }

  export interface HeifDecoderInstance {
    decode(data: Uint8Array): HeifDecodedImage[]
  }

  export const HeifDecoder: new () => HeifDecoderInstance

  const libheif: {
    HeifDecoder: new () => HeifDecoderInstance
  }

  export default libheif
}
