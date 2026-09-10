export function createPageViewVisitGate() {
  let previous: { pathname: string; settingsSearch: string | undefined } | undefined

  return {
    shouldTrack(pathname: string, settingsSearch: string | undefined): boolean {
      if (previous?.pathname === pathname && previous.settingsSearch === settingsSearch) {
        return false
      }
      previous = { pathname, settingsSearch }
      return true
    },
  }
}
