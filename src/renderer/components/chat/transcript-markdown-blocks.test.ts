import type { Root } from 'hast'
import { describe, expect, it } from 'vitest'
import { rehypeTranscriptBlocks } from './transcript-markdown-blocks'

describe('transcript Markdown block identities', () => {
  it('marks existing top-level AST blocks and keeps their identities when a stream appends blocks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 10, offset: 9 } },
          children: [{ type: 'text', value: 'paragraph' }],
        },
        { type: 'text', value: '\n' },
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          position: { start: { line: 3, column: 1, offset: 11 }, end: { line: 6, column: 1, offset: 30 } },
          children: [],
        },
      ],
    }
    const mark = rehypeTranscriptBlocks({ sourceId: 'message-part' })
    mark(tree)
    expect(
      tree.children.filter((node) => node.type === 'element').map((node) => node.properties['data-transcript-block'])
    ).toEqual(['message-part:0', 'message-part:11'])
    tree.children.push({ type: 'element', tagName: 'p', properties: {}, children: [] })
    mark(tree)
    expect(tree.children[0]).toMatchObject({ properties: { 'data-transcript-block': 'message-part:0' } })
    expect(tree.children[2]).toMatchObject({ properties: { 'data-transcript-block': 'message-part:11' } })
  })
})
