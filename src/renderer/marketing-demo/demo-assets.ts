import platform from '@/platform'

export const DEMO_HERO_IMAGE_KEY = 'demo-product-hero'
export const DEMO_GEN_IMAGE_1_KEY = 'picture:image-gen:demo-cat-window'

const CAT_WINDOW_URL = new URL('./assets/cat-window.jpg', import.meta.url).href

const DEMO_HERO_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect width="640" height="400" rx="28" fill="#f8f9fa"/>
  <rect x="28" y="28" width="584" height="344" rx="18" fill="#ffffff" stroke="#dee2e6"/>
  <rect x="48" y="52" width="160" height="300" rx="12" fill="#f3f3f3"/>
  <rect x="72" y="76" width="112" height="14" rx="7" fill="#228be6"/>
  <rect x="72" y="108" width="96" height="10" rx="5" fill="#ced4da"/>
  <rect x="72" y="128" width="84" height="10" rx="5" fill="#dee2e6"/>
  <rect x="232" y="76" width="340" height="18" rx="9" fill="#212529"/>
  <rect x="232" y="120" width="220" height="72" rx="16" fill="#228be6"/>
  <rect x="280" y="220" width="292" height="88" rx="16" fill="#f3f3f3"/>
  <circle cx="88" cy="322" r="14" fill="#228be6"/>
</svg>
`)}`

async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`failed to load demo image: ${url}`)
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function seedDemoBlobs(): Promise<void> {
  await platform.setStoreBlob(DEMO_HERO_IMAGE_KEY, DEMO_HERO_IMAGE)
  await platform.setStoreBlob(DEMO_GEN_IMAGE_1_KEY, await urlToDataUrl(CAT_WINDOW_URL))
}
