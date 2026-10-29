import { getLogger } from '../util'

const log = getLogger('skills:github-fetcher')

const GITHUB_API_BASE = 'https://api.github.com'
const USER_AGENT = 'chatbox-app'
const CACHE_TTL_MS = 5 * 60 * 1000

interface GitHubContentItem {
  name: string
  path: string
  type: 'file' | 'dir'
  sha: string
  download_url: string | null
}

interface GitHubCommitItem {
  sha: string
}

interface GitHubTreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

interface GitHubTreeResponse {
  sha: string
  tree: GitHubTreeItem[]
  truncated: boolean
}

export interface DetectedSkill {
  name: string
  path: string
  description?: string
}

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.data as T
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function clearCache(): void {
  cache.clear()
}

class GitHubApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

async function githubFetch<T>(url: string): Promise<T> {
  const cached = getCached<T>(url)
  if (cached !== undefined) return cached

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubApiError(`Not found: ${url}`, 404)
    }
    if (response.status === 403) {
      throw new GitHubApiError('GitHub API rate limit exceeded. Try again later.', 403)
    }
    throw new GitHubApiError(`GitHub API error: ${response.status} ${response.statusText}`, response.status)
  }

  const data = (await response.json()) as T
  setCache(url, data)
  return data
}

async function fetchRepoTree(owner: string, repo: string): Promise<GitHubTreeResponse | null> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
  const result = await githubFetch<GitHubTreeResponse>(url)
  if (!Array.isArray(result?.tree)) {
    log.warn(`Unexpected tree response shape for ${owner}/${repo}`)
    return null
  }
  if (result.truncated) {
    log.warn(`Tree listing truncated for ${owner}/${repo}`)
    return null
  }
  return result
}

export async function fetchRepoContents(owner: string, repo: string, repoPath = ''): Promise<GitHubContentItem[]> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${repoPath}`
  try {
    const result = await githubFetch<GitHubContentItem[] | GitHubContentItem>(url)
    return Array.isArray(result) ? result : [result]
  } catch (error) {
    if (error instanceof GitHubApiError && error.statusCode === 404) {
      return []
    }
    throw error
  }
}

const MAX_DETECTED_SKILLS = 100
const SKILL_CONTENT_FETCH_BATCH = 8
const SKILL_FILE_DOWNLOAD_BATCH = 8
// Bounds for the contents-API fallback scan (used only when the tree API is
// truncated/unavailable). Each directory costs one API call, so both a depth
// and a total-call cap protect the often-unauthenticated 60/hour rate limit.
const MAX_FALLBACK_SCAN_DEPTH = 6
const MAX_FALLBACK_API_CALLS = 60

// raw.githubusercontent.com can be unreachable while api.github.com works (common
// behind some firewalls). In that case the tree listing succeeds but every content
// fetch fails — surface the network error instead of reporting "no skills in repo".
class SkillContentUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillContentUnavailableError'
  }
}

export async function detectSkillsInRepo(owner: string, repo: string): Promise<DetectedSkill[]> {
  try {
    const detected = await detectSkillsViaTree(owner, repo)
    if (detected !== null) return detected
  } catch (error) {
    if (error instanceof GitHubApiError && (error.statusCode === 403 || error.statusCode === 429)) {
      throw error
    }
    if (error instanceof SkillContentUnavailableError) {
      throw error
    }
    log.warn(`Tree-based skill detection failed for ${owner}/${repo}, falling back to contents API`, error)
  }
  return detectSkillsViaContents(owner, repo)
}

// Lists the full repo tree in one API call, so SKILL.md files are found at any
// depth (e.g. skills/{category}/{name}/SKILL.md). Returns null when the tree is
// truncated by GitHub or malformed, so the caller can fall back to the contents API.
async function detectSkillsViaTree(owner: string, repo: string): Promise<DetectedSkill[] | null> {
  const result = await fetchRepoTree(owner, repo)
  if (!result) return null

  const skillMdPaths = result.tree
    .filter((item) => item.type === 'blob' && (item.path === 'SKILL.md' || item.path.endsWith('/SKILL.md')))
    .filter((item) => !item.path.split('/').includes('node_modules'))
    .map((item) => item.path)

  if (skillMdPaths.length > MAX_DETECTED_SKILLS) {
    log.warn(
      `Repo ${owner}/${repo} has ${skillMdPaths.length} skills, only the first ${MAX_DETECTED_SKILLS} are listed`
    )
  }

  const limitedPaths = skillMdPaths.slice(0, MAX_DETECTED_SKILLS)
  const detected: DetectedSkill[] = []
  let fetchFailures = 0
  for (let i = 0; i < limitedPaths.length; i += SKILL_CONTENT_FETCH_BATCH) {
    const batch = await Promise.all(
      limitedPaths.slice(i, i + SKILL_CONTENT_FETCH_BATCH).map(async (skillMdPath): Promise<DetectedSkill | null> => {
        const skillPath = skillMdPath === 'SKILL.md' ? '' : skillMdPath.slice(0, -'/SKILL.md'.length)
        try {
          const content = await fetchFileContent(owner, repo, skillMdPath)
          return {
            name: extractSkillName(content) || skillPath.split('/').pop() || repo,
            path: skillPath,
            description: extractSkillDescription(content),
          }
        } catch (error) {
          log.warn(`Failed to fetch ${skillMdPath} from ${owner}/${repo}`, error)
          fetchFailures++
          return null
        }
      })
    )
    detected.push(...batch.filter((skill): skill is DetectedSkill => skill !== null))
  }

  if (limitedPaths.length > 0 && fetchFailures === limitedPaths.length) {
    throw new SkillContentUnavailableError(
      `Found ${limitedPaths.length} skill(s) in ${owner}/${repo} but failed to fetch their contents`
    )
  }
  return detected
}

// Recursively walks the repo via the contents API (one call per directory)
// looking for SKILL.md at any depth — no assumption about folder naming
// (doesn't require a literal "skills/" directory anywhere in the path).
// Once a directory is found to contain SKILL.md it's treated as a leaf and
// isn't searched further, matching the tree-based strategy's behavior.
// Bounded by depth and a call budget since the tree API being unavailable
// often means the unauthenticated (60/hour) rate limit is already a concern.
async function scanDirForSkills(
  owner: string,
  repo: string,
  dirPath: string,
  depth: number,
  detected: DetectedSkill[],
  budget: { calls: number }
): Promise<void> {
  if (detected.length >= MAX_DETECTED_SKILLS) return
  if (depth > MAX_FALLBACK_SCAN_DEPTH) return
  if (budget.calls >= MAX_FALLBACK_API_CALLS) return

  budget.calls++
  let contents: GitHubContentItem[]
  try {
    contents = await fetchRepoContents(owner, repo, dirPath)
  } catch (error) {
    log.warn(`Failed to list contents of "${dirPath}" for ${owner}/${repo}`, error)
    return
  }

  const skillMdItem = contents.find((item) => item.name === 'SKILL.md' && item.type === 'file')
  if (skillMdItem) {
    try {
      const skillMdRepoPath = dirPath ? `${dirPath}/SKILL.md` : 'SKILL.md'
      const content = await fetchFileContent(owner, repo, skillMdRepoPath)
      detected.push({
        name: extractSkillName(content) || dirPath.split('/').pop() || repo,
        path: dirPath,
        description: extractSkillDescription(content),
      })
    } catch (error) {
      log.warn(`Failed to fetch SKILL.md at "${dirPath}" for ${owner}/${repo}`, error)
    }
    return
  }

  const subDirs = contents.filter((item) => item.type === 'dir' && item.name !== 'node_modules')
  for (const sub of subDirs) {
    if (budget.calls >= MAX_FALLBACK_API_CALLS || detected.length >= MAX_DETECTED_SKILLS) break
    const subPath = dirPath ? `${dirPath}/${sub.name}` : sub.name
    await scanDirForSkills(owner, repo, subPath, depth + 1, detected, budget)
  }
}

// Fallback used only when the git tree API is unavailable or truncated.
async function detectSkillsViaContents(owner: string, repo: string): Promise<DetectedSkill[]> {
  const detected: DetectedSkill[] = []
  const budget = { calls: 0 }
  try {
    await scanDirForSkills(owner, repo, '', 0, detected, budget)
  } catch (error) {
    log.warn(`Recursive contents-based skill scan failed for ${owner}/${repo}`, error)
  }
  return detected
}

export async function fetchFileContent(owner: string, repo: string, filePath: string): Promise<string> {
  // Git allows `#`/`?` in filenames — encode per segment so they don't truncate the URL
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodedPath}`

  const cached = getCached<string>(url)
  if (cached !== undefined) return cached

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!response.ok) {
    throw new GitHubApiError(`Failed to fetch file: ${filePath}`, response.status)
  }

  const content = await response.text()
  setCache(url, content)
  return content
}

export async function downloadSkillFiles(
  owner: string,
  repo: string,
  skillPath: string,
  targetDir: string
): Promise<void> {
  try {
    const downloaded = await downloadSkillFilesViaTree(owner, repo, skillPath, targetDir)
    if (downloaded) return
  } catch (error) {
    if (error instanceof GitHubApiError && (error.statusCode === 403 || error.statusCode === 429)) {
      throw error
    }
    log.warn(`Tree-based skill download failed for ${owner}/${repo}/${skillPath}, falling back to contents API`, error)
  }
  await downloadSkillFilesViaContents(owner, repo, skillPath, targetDir)
}

async function downloadSkillFilesViaTree(
  owner: string,
  repo: string,
  skillPath: string,
  targetDir: string
): Promise<boolean> {
  const fs = await import('node:fs')
  const pathModule = await import('node:path')

  fs.mkdirSync(targetDir, { recursive: true })
  const normalizedSkillPath = skillPath.replace(/^\/+|\/+$/g, '')
  const result = await fetchRepoTree(owner, repo)
  if (!result) return false

  const prefix = normalizedSkillPath ? `${normalizedSkillPath}/` : ''
  const files = result.tree.filter((item) => {
    if (item.type !== 'blob') return false
    if (normalizedSkillPath) return item.path.startsWith(prefix)
    return !item.path.split('/').includes('node_modules')
  })

  if (files.length === 0) {
    return false
  }

  for (let i = 0; i < files.length; i += SKILL_FILE_DOWNLOAD_BATCH) {
    await Promise.all(
      files.slice(i, i + SKILL_FILE_DOWNLOAD_BATCH).map(async (item) => {
        const relativePath = normalizedSkillPath ? item.path.slice(prefix.length) : item.path
        if (!relativePath) return
        const localPath = pathModule.join(targetDir, relativePath)
        const content = await fetchFileContent(owner, repo, item.path)
        const dir = pathModule.dirname(localPath)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(localPath, content, 'utf-8')
      })
    )
  }

  return true
}

async function downloadSkillFilesViaContents(
  owner: string,
  repo: string,
  skillPath: string,
  targetDir: string
): Promise<void> {
  const fs = await import('node:fs')
  const pathModule = await import('node:path')

  fs.mkdirSync(targetDir, { recursive: true })

  const contentsPath = skillPath || ''
  const contents = await fetchRepoContents(owner, repo, contentsPath)

  for (const item of contents) {
    const relativePath = skillPath ? item.path.slice(skillPath.length + 1) : item.path
    const localPath = pathModule.join(targetDir, relativePath)

    if (item.type === 'file') {
      const content = await fetchFileContent(owner, repo, item.path)
      const dir = pathModule.dirname(localPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(localPath, content, 'utf-8')
    } else if (item.type === 'dir') {
      await downloadSkillFilesViaContents(owner, repo, item.path, pathModule.join(targetDir, relativePath))
    }
  }
}

// Returns a content identifier for the skill at `skillPath` derived from the git
// tree: the subtree SHA of that directory (or the root tree SHA for a repo-root
// skill). Unlike the commits API, this changes only when files under the skill
// path actually change, so unrelated commits elsewhere in the repo (or to sibling
// skills) don't produce false "update available" reports. Returns null when the
// tree is truncated/unavailable so the caller can fall back to commit comparison.
export async function getSkillTreeSha(owner: string, repo: string, skillPath: string): Promise<string | null> {
  try {
    const result = await fetchRepoTree(owner, repo)
    if (!result) return null
    const normalized = skillPath.replace(/^\/+|\/+$/g, '')
    if (!normalized) return result.sha ?? null
    const match = result.tree.find((item) => item.type === 'tree' && item.path === normalized)
    return match?.sha ?? null
  } catch (error) {
    log.error(`Failed to get skill tree sha for ${owner}/${repo}/${skillPath}`, error)
    return null
  }
}

export async function getLatestCommitHash(owner: string, repo: string, repoPath: string): Promise<string | null> {
  const encodedPath = encodeURIComponent(repoPath || '.')
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?path=${encodedPath}&per_page=1`

  try {
    const commits = await githubFetch<GitHubCommitItem[]>(url)
    if (commits.length > 0) {
      return commits[0].sha
    }
    return null
  } catch (error) {
    log.error(`Failed to get latest commit hash for ${owner}/${repo}/${repoPath}`, error)
    return null
  }
}

// Regex: match `name:` line inside YAML frontmatter delimited by ---
function extractSkillName(content: string): string | undefined {
  const match = content.match(/^---\s*\n[\s\S]*?^name:\s*(.+?)\s*$/m)
  return match?.[1]?.replace(/^['"]|['"]$/g, '')
}

function extractSkillDescription(content: string): string | undefined {
  const match = content.match(/^---\s*\n[\s\S]*?^description:\s*(.+?)\s*$/m)
  return match?.[1]?.replace(/^['"]|['"]$/g, '')
}
