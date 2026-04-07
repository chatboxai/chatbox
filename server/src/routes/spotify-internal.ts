import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { searchTracks, createPlaylist, addTracksToPlaylist } from '../services/spotify'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
})

const CreatePlaylistSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trackQueries: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        // LLMs often send a comma-separated string instead of an array
        return val.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
      }
      return val
    },
    z.array(z.string().min(1)).min(1)
  ),
})

// GET /api/internal/spotify/status
router.get('/status', async (req: AuthRequest, res) => {
  const userId = req.user!.userId

  const configured = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
  if (!configured) {
    res.json({ connected: false, configured: false })
    return
  }

  const stored = await prisma.oAuthToken.findUnique({
    where: { userId_provider: { userId, provider: 'spotify' } },
    select: { expiresAt: true },
  })

  const connected = Boolean(
    stored && (!stored.expiresAt || stored.expiresAt.getTime() > Date.now())
  )

  res.json({ connected, configured: true })
})

// POST /api/internal/spotify/search
router.post('/search', async (req: AuthRequest, res) => {
  const parsed = SearchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' })
    return
  }

  const userId = req.user!.userId
  const { query, limit } = parsed.data

  try {
    const tracks = await searchTracks(userId, query, limit)
    res.json({ tracks })
  } catch (err) {
    if (err instanceof Error && err.message === 'auth_required') {
      res.status(401).json({ error: 'auth_required', provider: 'spotify' })
      return
    }
    if (err instanceof Error && err.message === 'permission_denied') {
      res.status(403).json({ error: 'permission_denied', message: 'Spotify permission denied. Ensure your app has the required scopes and the user is added as a tester in the Spotify Developer Dashboard.' })
      return
    }
    console.error('[Spotify] Search error', err)
    res.status(500).json({ error: 'Failed to search tracks' })
  }
})

// POST /api/internal/spotify/create-playlist
router.post('/create-playlist', async (req: AuthRequest, res) => {
  const parsed = CreatePlaylistSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' })
    return
  }

  const userId = req.user!.userId
  const { name, description, trackQueries } = parsed.data

  try {
    const playlist = await createPlaylist(userId, name, description ?? '')

    // Search for tracks concurrently in small batches to stay fast but avoid rate limits
    const foundTracks: Awaited<ReturnType<typeof searchTracks>> = []
    const BATCH_SIZE = 5
    for (let i = 0; i < trackQueries.length; i += BATCH_SIZE) {
      const batch = trackQueries.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map((q) => searchTracks(userId, q, 1))
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value[0]) {
          foundTracks.push(r.value[0])
        }
      }
      // Small delay between batches if more to come
      if (i + BATCH_SIZE < trackQueries.length) {
        await new Promise((r) => setTimeout(r, 200))
      }
    }

    const trackUris = foundTracks.map((t) => t.uri)
    let tracksAdded = 0
    let addTracksWarning: string | undefined

    if (trackUris.length > 0) {
      // Brief delay after playlist creation for Spotify propagation
      await new Promise((r) => setTimeout(r, 500))
      try {
        const result = await addTracksToPlaylist(userId, playlist.id, trackUris)
        tracksAdded = result.added
        if (result.failed > 0) {
          addTracksWarning = `${result.added} tracks added, ${result.failed} failed. You may need to add some tracks manually in Spotify.`
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        console.error('[Spotify] addTracksToPlaylist failed (' + msg + '), returning partial success')
        addTracksWarning = 'Playlist created but adding tracks failed (' + msg + '). Try adding tracks manually in Spotify.'
      }
    }

    res.json({
      playlist: { id: playlist.id, url: playlist.url, name },
      tracksAdded,
      tracksFound: foundTracks.length,
      tracks: foundTracks,
      ...(addTracksWarning ? { warning: addTracksWarning } : {}),
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'auth_required') {
      res.status(401).json({ error: 'auth_required', provider: 'spotify' })
      return
    }
    if (err instanceof Error && err.message === 'permission_denied') {
      res.status(403).json({ error: 'permission_denied', message: 'Spotify returned 403 Forbidden. Check that your Spotify app has playlist-modify-public/private scopes and the account is added as a tester in the Spotify Developer Dashboard.' })
      return
    }
    console.error('[Spotify] Create playlist error', err)
    res.status(500).json({ error: 'Failed to create playlist' })
  }
})

export default router
