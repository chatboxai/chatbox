import { describe, expect, it } from 'vitest'
import { createArtifactPreviewRuntimeMarkup } from './artifact-runtime'

describe('createArtifactPreviewRuntimeMarkup', () => {
  it('builds a local runtime that waits for host bootstrap and renders into a sandboxed iframe', () => {
    const markup = createArtifactPreviewRuntimeMarkup()

    expect(markup).toContain('host.bootstrap')
    expect(markup).toContain('Artifact preview runtime')
    expect(markup).toContain("sandbox', 'allow-scripts allow-forms'")
    expect(markup).toContain('app.ready')
    expect(markup).toContain('app.state')
  })
})
