import platform from '@/platform'

export async function openLinkWithAuth(url: string): Promise<void> {
  await platform.openLink(url)
}
