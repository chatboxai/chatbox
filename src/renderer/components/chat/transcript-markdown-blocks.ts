import type { Root } from 'hast'

/** Uses the renderer's existing AST; block identities contain no message content. */
export function rehypeTranscriptBlocks(options: { sourceId: string }) {
  return (tree: Root) => {
    tree.children.forEach((node, index) => {
      if (node.type !== 'element') return
      node.properties['data-transcript-block'] = `${options.sourceId}:${node.position?.start.offset ?? index}`
    })
  }
}
