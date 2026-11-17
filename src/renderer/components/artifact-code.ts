export const CODE_BLOCK_LANGUAGES = ['html', 'js', 'javascript', 'css'] as const
export type CodeBlockLanguage = (typeof CODE_BLOCK_LANGUAGES)[number]

export interface ArtifactCode {
  blocks: Partial<Record<CodeBlockLanguage, string>>
  currentType: CodeBlockLanguage | null
  currentContent: string
}

export function createArtifactCode(): ArtifactCode {
  return { blocks: {}, currentType: null, currentContent: '' }
}

export function appendArtifactMarkdown(code: ArtifactCode, markdown: string): void {
  for (let line of markdown.split('\n')) {
    line = line.trimStart()
    const language = CODE_BLOCK_LANGUAGES.find((value) => `\`\`\`${value}` === line)
    if (language) {
      code.currentType = language
      continue
    }
    if (line === '```') {
      if (code.currentContent && code.currentType) {
        code.blocks[code.currentType] = code.currentContent
        code.currentContent = ''
        code.currentType = null
      }
      continue
    }
    if (code.currentType) code.currentContent += `${line}\n`
  }
}

export function renderArtifactCode(history: ArtifactCode, markdown: string): string {
  const code = { ...history, blocks: { ...history.blocks } }
  appendArtifactMarkdown(code, markdown)
  if (!code.blocks.html) return ''
  return `
<script src="https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp,container-queries"></script>

${code.blocks.html}

<style>
${code.blocks.css ?? ''}
</style>

<script>
${code.blocks.js ?? ''}
${code.blocks.javascript ?? ''}
</script>
    `
}
