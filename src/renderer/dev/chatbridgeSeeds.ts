import type { SessionMeta } from '@shared/types'
import { getChatBridgeLiveSeedFixtures, type ChatBridgeLiveSeedFixture } from '@shared/chatbridge/live-seeds'
import storage from '@/storage'
import { createSession, deleteSession, listSessionsMeta } from '@/stores/chatStore'

export function getChatBridgeLiveSeedCatalog(): ChatBridgeLiveSeedFixture[] {
  return getChatBridgeLiveSeedFixtures()
}

export function isChatBridgeLiveSeedSession(name?: string): boolean {
  if (!name) {
    return false
  }

  return getChatBridgeLiveSeedCatalog().some((fixture) => fixture.name === name)
}

export function getExistingChatBridgeSeedSessions(sessionMetaList?: SessionMeta[]) {
  const fixtures = getChatBridgeLiveSeedCatalog()
  const existingByName = new Map((sessionMetaList || []).map((sessionMeta) => [sessionMeta.name, sessionMeta]))

  return fixtures.map((fixture) => ({
    fixture,
    existing: existingByName.get(fixture.name),
  }))
}

async function clearFixtureSession(fixture: ChatBridgeLiveSeedFixture, sessionMetaList?: SessionMeta[]) {
  const existing = (sessionMetaList || (await listSessionsMeta())).find((sessionMeta) => sessionMeta.name === fixture.name)
  if (existing) {
    await deleteSession(existing.id)
  }

  for (const blobEntry of fixture.blobEntries || []) {
    await storage.delBlob(blobEntry.key).catch(() => undefined)
  }
}

async function seedFixtureBlobs(fixture: ChatBridgeLiveSeedFixture) {
  for (const blobEntry of fixture.blobEntries || []) {
    await storage.setBlob(blobEntry.key, blobEntry.value)
  }
}

export async function clearChatBridgeLiveSeedSessions(fixtureIds?: string[]) {
  const sessionMetaList = await listSessionsMeta()
  const selectedFixtures = getChatBridgeLiveSeedCatalog().filter((fixture) =>
    fixtureIds ? fixtureIds.includes(fixture.id) : true
  )

  for (const fixture of selectedFixtures) {
    await clearFixtureSession(fixture, sessionMetaList)
  }
}

export async function reseedChatBridgeLiveSeedSessions(fixtureIds?: string[]) {
  const sessionMetaList = await listSessionsMeta()
  const selectedFixtures = getChatBridgeLiveSeedCatalog().filter((fixture) =>
    fixtureIds ? fixtureIds.includes(fixture.id) : true
  )

  const seededSessions: Array<{
    fixture: ChatBridgeLiveSeedFixture
    sessionId: string
  }> = []

  for (const fixture of selectedFixtures) {
    await clearFixtureSession(fixture, sessionMetaList)
    await seedFixtureBlobs(fixture)
    const session = await createSession(fixture.sessionInput)
    seededSessions.push({
      fixture,
      sessionId: session.id,
    })
  }

  return seededSessions
}
