import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'

const packageJsonPath = new URL('../package.json', import.meta.url)
const outputDir = new URL('../release/app/dist/renderer/', import.meta.url)
const headersSourcePath = new URL('../src/renderer/static/_headers', import.meta.url)
const healthzPath = new URL('../release/app/dist/renderer/healthz.json', import.meta.url)
const headersDestPath = new URL('../release/app/dist/renderer/_headers', import.meta.url)

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

await mkdir(outputDir, { recursive: true })

const healthPayload = {
  status: 'ok',
  app: 'chatbox-web',
  version: packageJson.version,
  buildPlatform: 'web',
  builtAt: new Date().toISOString(),
  commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null,
}

await writeFile(healthzPath, `${JSON.stringify(healthPayload, null, 2)}\n`)
await copyFile(headersSourcePath, headersDestPath)
