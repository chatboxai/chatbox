import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../util', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  clearCache,
  detectSkillsInRepo,
  downloadSkillFiles,
  fetchFileContent,
  fetchRepoContents,
  getLatestCommitHash,
  getSkillTreeSha,
} from '../github-fetcher'

function makeResponse(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

function makeContentItem(name: string, type: 'file' | 'dir', itemPath: string) {
  return {
    name,
    path: itemPath,
    type,
    sha: 'abc123',
    download_url: type === 'file' ? `https://raw.githubusercontent.com/test/${itemPath}` : null,
  }
}

function makeSkillMdContent(skillName: string, description = 'A test skill') {
  return `---\nname: ${skillName}\ndescription: ${description}\n---\n# Instructions\nDo something.`
}

describe('github-fetcher', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    clearCache()
  })

  afterEach(() => {
    clearCache()
  })

  describe('fetchRepoContents', () => {
    it('should return contents array from GitHub API', async () => {
      const items = [makeContentItem('SKILL.md', 'file', 'SKILL.md'), makeContentItem('README.md', 'file', 'README.md')]
      mockFetch.mockResolvedValueOnce(makeResponse(items))

      const result = await fetchRepoContents('owner', 'repo')
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('SKILL.md')
    })

    it('should return empty array on 404', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      const result = await fetchRepoContents('owner', 'repo', 'nonexistent')
      expect(result).toEqual([])
    })
  })

  describe('detectSkillsInRepo', () => {
    function makeTreeResponse(paths: string[], truncated = false) {
      return {
        sha: 'root-tree-sha',
        tree: paths.map((p) => ({ path: p, type: 'blob', sha: `blob-${p}` })),
        truncated,
      }
    }

    it('should detect root SKILL.md', async () => {
      const skillMdContent = makeSkillMdContent('my-skill', 'A great skill')

      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeResponse(['SKILL.md', 'README.md']))) // git tree
      mockFetch.mockResolvedValueOnce(makeResponse(skillMdContent, 200, true)) // SKILL.md content

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('my-skill')
      expect(detected[0].path).toBe('')
    })

    it('should detect skills in skills/ directory (flat structure)', async () => {
      const skillMd = makeSkillMdContent('my-tool', 'Tool description')

      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeResponse(['skills/my-tool/SKILL.md']))) // git tree
      mockFetch.mockResolvedValueOnce(makeResponse(skillMd, 200, true)) // SKILL.md content

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('my-tool')
      expect(detected[0].path).toBe('skills/my-tool')
    })

    // Content fetches run concurrently — key multi-skill mocks by URL, not call order
    function mockByUrl(tree: ReturnType<typeof makeTreeResponse>, contents: Record<string, string>) {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/git/trees/')) return Promise.resolve(makeResponse(tree))
        for (const [path, content] of Object.entries(contents)) {
          if (url.endsWith(`/HEAD/${path}`)) return Promise.resolve(makeResponse(content, 200, true))
        }
        return Promise.resolve(makeResponse(null, 404, false))
      })
    }

    it('should detect skills nested under category directories (skills/category/name pattern)', async () => {
      mockByUrl(
        makeTreeResponse([
          'skills/engineering/README.md',
          'skills/engineering/tdd/SKILL.md',
          'skills/productivity/triage/SKILL.md',
        ]),
        {
          'skills/engineering/tdd/SKILL.md': makeSkillMdContent('tdd', 'TDD workflow'),
          'skills/productivity/triage/SKILL.md': makeSkillMdContent('triage', 'Triage issues'),
        }
      )

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(2)
      expect(detected[0].name).toBe('tdd')
      expect(detected[0].path).toBe('skills/engineering/tdd')
      expect(detected[1].name).toBe('triage')
      expect(detected[1].path).toBe('skills/productivity/triage')
    })

    it('should not treat files merely named with SKILL.md suffix as skills', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeResponse(['docs/MY-SKILL.md', 'README.md'])))

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toEqual([])
    })

    it('should ignore SKILL.md under node_modules', async () => {
      mockByUrl(makeTreeResponse(['node_modules/some-pkg/SKILL.md', 'skills/real/SKILL.md']), {
        'skills/real/SKILL.md': makeSkillMdContent('real'),
      })

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].path).toBe('skills/real')
    })

    it('should detect category-nested skills via contents fallback when the tree is truncated', async () => {
      const rootContents = [makeContentItem('skills', 'dir', 'skills')]
      const skillsDirContents = [makeContentItem('engineering', 'dir', 'skills/engineering')]
      const categoryContents = [
        makeContentItem('README.md', 'file', 'skills/engineering/README.md'),
        makeContentItem('tdd', 'dir', 'skills/engineering/tdd'),
      ]
      const skillDirContents = [makeContentItem('SKILL.md', 'file', 'skills/engineering/tdd/SKILL.md')]

      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeResponse(['unrelated.md'], true))) // truncated tree
      mockFetch.mockResolvedValueOnce(makeResponse(rootContents)) // root contents
      mockFetch.mockResolvedValueOnce(makeResponse(skillsDirContents)) // skills/
      mockFetch.mockResolvedValueOnce(makeResponse(categoryContents)) // skills/engineering/ (no SKILL.md)
      mockFetch.mockResolvedValueOnce(makeResponse(skillDirContents)) // skills/engineering/tdd/
      mockFetch.mockResolvedValueOnce(makeResponse(makeSkillMdContent('tdd'), 200, true)) // SKILL.md

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('tdd')
      expect(detected[0].path).toBe('skills/engineering/tdd')
    })

    it('should ignore tree entries of type "tree" whose path ends in SKILL.md', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ tree: [{ path: 'skills/weird/SKILL.md', type: 'tree' }], truncated: false })
      )

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toEqual([])
      expect(mockFetch).toHaveBeenCalledTimes(1) // no content fetch attempted
    })

    it('should cap detected skills at 100 when the tree has more', async () => {
      const paths = Array.from({ length: 101 }, (_, i) => `skills/s${i}/SKILL.md`)
      const contents: Record<string, string> = {}
      for (const p of paths) {
        contents[p] = makeSkillMdContent(p.split('/')[1])
      }
      mockByUrl(makeTreeResponse(paths), contents)

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(100)
      expect(mockFetch).toHaveBeenCalledTimes(101) // 1 tree call + 100 content fetches (not 102)
    })

    it('should fall back to directory/repo name when SKILL.md has no name frontmatter', async () => {
      const noName = '---\ndescription: d\n---\n# body'
      mockByUrl(makeTreeResponse(['SKILL.md', 'skills/my-dir/SKILL.md']), {
        'SKILL.md': noName,
        'skills/my-dir/SKILL.md': noName,
      })

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected.map((s) => s.name).sort()).toEqual(['my-dir', 'repo'])
    })

    it('should throw when skills are listed but every content fetch fails', async () => {
      mockByUrl(makeTreeResponse(['skills/a/SKILL.md', 'skills/b/SKILL.md']), {}) // all raw fetches → 404

      await expect(detectSkillsInRepo('owner', 'repo')).rejects.toThrow('failed to fetch their contents')
    })

    it('should return empty array for repo with no skills', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeResponse(['README.md', 'src/index.ts'])))

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toEqual([])
    })

    it('should fall back to contents API when the tree is truncated', async () => {
      const rootContents = [makeContentItem('skills', 'dir', 'skills')]
      const skillsDirContents = [makeContentItem('my-tool', 'dir', 'skills/my-tool')]
      const subContents = [makeContentItem('SKILL.md', 'file', 'skills/my-tool/SKILL.md')]
      const skillMd = makeSkillMdContent('my-tool', 'Tool description')

      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeResponse(['unrelated.md'], true))) // truncated tree
      mockFetch.mockResolvedValueOnce(makeResponse(rootContents)) // root contents
      mockFetch.mockResolvedValueOnce(makeResponse(skillsDirContents)) // skills/
      mockFetch.mockResolvedValueOnce(makeResponse(subContents)) // skills/my-tool/
      mockFetch.mockResolvedValueOnce(makeResponse(skillMd, 200, true)) // SKILL.md content

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].path).toBe('skills/my-tool')
    })

    it('should fall back to contents API for an arbitrarily-named nested folder when the tree is truncated', async () => {
      // No folder here is literally named "skills" — e.g. ai/offensive-ai-security/SKILL.md.
      const rootContents = [makeContentItem('ai', 'dir', 'ai')]
      const categoryContents = [makeContentItem('offensive-ai-security', 'dir', 'ai/offensive-ai-security')]
      const subContents = [makeContentItem('SKILL.md', 'file', 'ai/offensive-ai-security/SKILL.md')]

      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeResponse(['unrelated.md'], true))) // truncated tree
      mockFetch.mockResolvedValueOnce(makeResponse(rootContents)) // root contents
      mockFetch.mockResolvedValueOnce(makeResponse(categoryContents)) // ai/
      mockFetch.mockResolvedValueOnce(makeResponse(subContents)) // ai/offensive-ai-security/
      mockFetch.mockResolvedValueOnce(makeResponse(makeSkillMdContent('offensive-ai-security'), 200, true)) // SKILL.md

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('offensive-ai-security')
      expect(detected[0].path).toBe('ai/offensive-ai-security')
    })

    it('should fall back to contents API when the tree API fails', async () => {
      const rootContents = [makeContentItem('SKILL.md', 'file', 'SKILL.md')]
      const skillMdContent = makeSkillMdContent('my-skill')

      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false)) // git tree → 404 (tree API unavailable)
      mockFetch.mockResolvedValueOnce(makeResponse(rootContents)) // root contents
      mockFetch.mockResolvedValueOnce(makeResponse(skillMdContent, 200, true)) // SKILL.md content
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false)) // skills/ → 404

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('my-skill')
      expect(detected[0].path).toBe('')
    })

    it('should propagate rate limit errors instead of falling back', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 403, false)) // git tree → 403

      await expect(detectSkillsInRepo('owner', 'repo')).rejects.toThrow('rate limit')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should skip skills whose SKILL.md cannot be fetched', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(makeTreeResponse(['skills/good/SKILL.md', 'skills/broken/SKILL.md']))
      )
      mockFetch.mockResolvedValueOnce(makeResponse(makeSkillMdContent('good'), 200, true))
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('good')
    })
  })

  describe('fetchFileContent', () => {
    it('should fetch and return file content', async () => {
      const content = '# Hello World'
      mockFetch.mockResolvedValueOnce(makeResponse(content, 200, true))

      const result = await fetchFileContent('owner', 'repo', 'README.md')
      expect(result).toBe(content)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/HEAD/README.md',
        expect.objectContaining({ headers: expect.any(Object) })
      )
    })

    it('should throw GitHubApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      await expect(fetchFileContent('owner', 'repo', 'missing.md')).rejects.toThrow('Failed to fetch file')
    })
  })

  describe('downloadSkillFiles', () => {
    it('downloads a skill directory using one tree API request instead of recursive contents requests', async () => {
      const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbox-skill-test-'))

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/git/trees/')) {
          return Promise.resolve(
            makeResponse({
              tree: [
                { path: 'skills/demo/SKILL.md', type: 'blob' },
                { path: 'skills/demo/scripts/run.sh', type: 'blob' },
                { path: 'skills/other/SKILL.md', type: 'blob' },
              ],
              truncated: false,
            })
          )
        }
        if (url.endsWith('/HEAD/skills/demo/SKILL.md')) {
          return Promise.resolve(makeResponse(makeSkillMdContent('demo'), 200, true))
        }
        if (url.endsWith('/HEAD/skills/demo/scripts/run.sh')) {
          return Promise.resolve(makeResponse('#!/bin/sh\necho demo', 200, true))
        }
        return Promise.resolve(makeResponse(null, 404, false))
      })

      try {
        await downloadSkillFiles('owner', 'repo', 'skills/demo', targetDir)

        expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8')).toContain('name: demo')
        expect(fs.readFileSync(path.join(targetDir, 'scripts/run.sh'), 'utf-8')).toContain('echo demo')
        expect(mockFetch).toHaveBeenCalledTimes(3)
        expect(mockFetch.mock.calls[0][0]).toContain('/git/trees/HEAD?recursive=1')
        expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/contents/'))).toBe(false)
      } finally {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }
    })
  })

  describe('getLatestCommitHash', () => {
    it('should return latest commit sha', async () => {
      const commits = [{ sha: 'abc123def456' }]
      mockFetch.mockResolvedValueOnce(makeResponse(commits))

      const hash = await getLatestCommitHash('owner', 'repo', 'skills/my-skill')
      expect(hash).toBe('abc123def456')
    })

    it('should return null on empty commits', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]))

      const hash = await getLatestCommitHash('owner', 'repo', '')
      expect(hash).toBeNull()
    })

    it('should return null on error', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 500, false))

      const hash = await getLatestCommitHash('owner', 'repo', 'path')
      expect(hash).toBeNull()
    })
  })

  describe('getSkillTreeSha', () => {
    function makeTreeWithDirs() {
      return {
        sha: 'root-tree-sha',
        truncated: false,
        tree: [
          { path: 'skills', type: 'tree', sha: 'skills-dir-sha' },
          { path: 'skills/my-skill', type: 'tree', sha: 'my-skill-tree-sha' },
          { path: 'skills/my-skill/SKILL.md', type: 'blob', sha: 'skillmd-blob-sha' },
          { path: 'skills/other', type: 'tree', sha: 'other-tree-sha' },
        ],
      }
    }

    it('should return the subtree sha for a nested skill path', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeWithDirs()))

      const sha = await getSkillTreeSha('owner', 'repo', 'skills/my-skill')
      expect(sha).toBe('my-skill-tree-sha')
    })

    it('should tolerate leading/trailing slashes in the skill path', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeWithDirs()))

      const sha = await getSkillTreeSha('owner', 'repo', '/skills/my-skill/')
      expect(sha).toBe('my-skill-tree-sha')
    })

    it('should return the root tree sha for a repo-root skill', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeWithDirs()))

      const sha = await getSkillTreeSha('owner', 'repo', '')
      expect(sha).toBe('root-tree-sha')
    })

    it('should return null when the path has no matching tree entry', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTreeWithDirs()))

      const sha = await getSkillTreeSha('owner', 'repo', 'skills/missing')
      expect(sha).toBeNull()
    })

    it('should return null when the tree is truncated', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ sha: 'x', tree: [], truncated: true }))

      const sha = await getSkillTreeSha('owner', 'repo', 'skills/my-skill')
      expect(sha).toBeNull()
    })
  })

  describe('API error handling', () => {
    it('should throw GitHubApiError with rate limit message on 403', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 403, false))

      await expect(fetchRepoContents('owner', 'repo')).rejects.toThrow('rate limit')
    })

    it('should handle 404 gracefully in fetchRepoContents', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      const result = await fetchRepoContents('owner', 'repo', 'missing')
      expect(result).toEqual([])
    })
  })
})
