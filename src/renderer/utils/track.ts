export function trackEvent(event: string, props: Record<string, unknown> = {}) {
  if ((window as any).plausible) {
    ;(window as any).plausible(event, { props })
  }
}
