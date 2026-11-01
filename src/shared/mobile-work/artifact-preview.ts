/** The trusted parent policy also governs navigation of the opaque preview frame. */
export function buildWorkArtifactPreview(html: string): string {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  const content = html
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  // srcdoc can load under frame-src 'none'; subsequent network navigations cannot.
  // Keep user scripts in this child so they cannot replace the trusted parent's policy.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style></head><body><iframe title="File preview" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${content}"></iframe></body></html>`
}

export function isWorkArtifactPreviewNavigation(url: string): boolean {
  return /^(?:about:blank|about:srcdoc)(?:#.*)?$/.test(url)
}
