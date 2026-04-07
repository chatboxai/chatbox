import { prisma } from '../lib/prisma'

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'

export interface SpotifyTrack {
  id: string
  name: string
  artist: string
  album: string
  uri: string
  previewUrl: string | null
  imageUrl: string | null
}

interface SpotifyTokenRefreshResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

interface SpotifySearchResponse {
  tracks: {
    items: Array<{
      id: string
      name: string
      uri: string
      artists: Array<{ name: string }>
      album: { name: string; images: Array<{ url: string }> }
      preview_url: string | null
    }>
  }
}

interface SpotifyCreatePlaylistResponse {
  id: string
  external_urls: { spotify: string }
}

export async function refreshToken(userId: string): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const stored = await prisma.oAuthToken.findUnique({
    where: { userId_provider: { userId, provider: 'spotify' } },
    select: { refreshToken: true },
  })
  if (!stored?.refreshToken) return null

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    }),
  })

  if (!res.ok) {
    console.error('[Spotify] Token refresh failed', res.status, await res.text())
    return null
  }

  const data = (await res.json()) as SpotifyTokenRefreshResponse
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  await prisma.oAuthToken.update({
    where: { userId_provider: { userId, provider: 'spotify' } },
    data: {
      accessToken: data.access_token,
      expiresAt,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    },
  })

  return data.access_token
}

// Get a valid access token, auto-refreshing if expired
export async function getSpotifyToken(userId: string): Promise<string | null> {
  const stored = await prisma.oAuthToken.findUnique({
    where: { userId_provider: { userId, provider: 'spotify' } },
    select: { accessToken: true, expiresAt: true },
  })

  if (!stored) return null

  // Refresh if expires within 5 minutes
  if (stored.expiresAt && stored.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    return refreshToken(userId)
  }

  return stored.accessToken
}

async function spotifyFetch<T>(accessToken: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    const retryAfter = res.headers.get('retry-after')
    if (res.status === 401) {
      console.error(`[Spotify] Token expired/invalid on ${path}: ${body}`)
      throw new Error('auth_required')
    }
    if (res.status === 403) {
      console.error(`[Spotify] 403 on ${path}: ${body}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`)
      throw new Error('permission_denied')
    }
    if (res.status === 429) {
      console.error(`[Spotify] Rate limited on ${path}, retry-after: ${retryAfter}`)
      throw new Error(`rate_limited:${retryAfter ?? '5'}`)
    }
    throw new Error(`Spotify API ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

export async function searchTracks(
  userId: string,
  query: string,
  limit = 5
): Promise<SpotifyTrack[]> {
  const accessToken = await getSpotifyToken(userId)
  if (!accessToken) throw new Error('auth_required')

  const params = new URLSearchParams({ q: query, type: 'track', limit: String(Math.min(limit, 20)) })
  const data = await spotifyFetch<SpotifySearchResponse>(accessToken, `/search?${params}`)

  return data.tracks.items.map((item) => ({
    id: item.id,
    name: item.name,
    artist: item.artists[0]?.name ?? 'Unknown Artist',
    album: item.album.name,
    uri: item.uri,
    previewUrl: item.preview_url,
    imageUrl: item.album.images[0]?.url ?? null,
  }))
}

export async function createPlaylist(
  userId: string,
  name: string,
  description = ''
): Promise<{ id: string; url: string }> {
  const accessToken = await getSpotifyToken(userId)
  if (!accessToken) throw new Error('auth_required')

  // Use /me/playlists (simpler, avoids user ID lookup, works in dev mode)
  const playlist = await spotifyFetch<SpotifyCreatePlaylistResponse>(
    accessToken,
    '/me/playlists',
    {
      method: 'POST',
      body: JSON.stringify({ name, description, public: true }),
    }
  )

  console.log(`[Spotify] Playlist created: ${playlist.id} (${playlist.external_urls.spotify})`)
  return { id: playlist.id, url: playlist.external_urls.spotify }
}

export async function addTracksToPlaylist(
  userId: string,
  playlistId: string,
  trackUris: string[]
): Promise<{ added: number; failed: number }> {
  if (trackUris.length === 0) return { added: 0, failed: 0 }

  const accessToken = await getSpotifyToken(userId)
  if (!accessToken) throw new Error('auth_required')

  // Spotify migrated /tracks → /items in Feb 2026
  const itemsPath = '/playlists/' + playlistId + '/items'
  const tracksPath = '/playlists/' + playlistId + '/tracks'

  // Batch add all tracks in one request (Spotify supports up to 100 per request)
  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100)
    try {
      await spotifyFetch(accessToken, itemsPath, {
        method: 'POST',
        body: JSON.stringify({ uris: batch }),
      })
      console.log(`[Spotify] Added batch of ${batch.length} tracks to playlist ${playlistId}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      if (msg === 'permission_denied') {
        // Fallback to old /tracks endpoint
        console.log('[Spotify] /items returned 403, trying /tracks fallback')
        try {
          await spotifyFetch(accessToken, tracksPath, {
            method: 'POST',
            body: JSON.stringify({ uris: batch }),
          })
          console.log(`[Spotify] Added batch via /tracks fallback`)
          continue
        } catch (fbErr) {
          console.error('[Spotify] Both /items and /tracks failed:', fbErr instanceof Error ? fbErr.message : fbErr)
          return { added: i, failed: trackUris.length - i }
        }
      }
      if (msg.startsWith('rate_limited:')) {
        const waitSec = parseInt(msg.split(':')[1] ?? '5', 10)
        console.log(`[Spotify] Rate limited, waiting ${waitSec}s before retry`)
        await new Promise((r) => setTimeout(r, waitSec * 1000))
        i -= 100 // retry this batch
        continue
      }
      console.error(`[Spotify] Failed to add batch: ${msg}`)
      return { added: i, failed: trackUris.length - i }
    }
  }

  console.log(`[Spotify] addTracksToPlaylist complete: ${trackUris.length} added`)
  return { added: trackUris.length, failed: 0 }
}
