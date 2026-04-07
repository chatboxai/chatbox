import { Router } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'

const router = Router()

// In-memory CSRF state store (single-instance — fine for sprint)
const pendingStates = new Map<string, { userId: string; expiresAt: number }>()

// Clean up expired states every 5 minutes (unref so it doesn't block test/process exit)
const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, val] of pendingStates) {
    if (val.expiresAt < now) pendingStates.delete(key)
  }
}, 5 * 60 * 1000)
cleanupInterval.unref()

const JWT_SECRET = process.env.JWT_SECRET as string
const rawClientUrl = process.env.CLIENT_URL ?? 'http://127.0.0.1:3000'
const CLIENT_URL = rawClientUrl.startsWith('http') ? rawClientUrl : `https://${rawClientUrl}`
const SPOTIFY_REDIRECT_URI = `${CLIENT_URL}/api/oauth/spotify/callback`

// GET /api/oauth/spotify/authorize?token=JWT
// Opens in a popup — JWT passed as query param since Authorization header isn't available
router.get('/spotify/authorize', (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    res.status(200).send(`<!DOCTYPE html><html><head><title>Spotify OAuth</title></head><body style="font-family:system-ui;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center;padding:24px;background:#282828;border-radius:12px;max-width:400px">
        <h2 style="color:#1db954;margin-bottom:12px">Spotify Not Configured</h2>
        <p style="color:#b3b3b3;margin-bottom:16px">Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to server/.env to enable Spotify integration.</p>
        <button onclick="window.close()" style="background:#1db954;color:#000;border:none;padding:10px 24px;border-radius:20px;cursor:pointer;font-weight:600">Close</button>
      </div>
    </body></html>`)
    return
  }

  const token = req.query.token as string | undefined
  if (!token) {
    res.status(401).json({ error: 'token query parameter required' })
    return
  }

  let userId: string
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string }
    userId = payload.userId
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  pendingStates.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 })

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: 'playlist-modify-public playlist-modify-private user-read-private',
    state,
    show_dialog: 'true',
  })

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`)
})

// GET /api/oauth/spotify/callback?code=...&state=...
router.get('/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>

  if (error) {
    res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center;padding:24px;background:#282828;border-radius:12px">
        <h2 style="color:#e74c3c">Authorization Denied</h2>
        <p style="color:#b3b3b3">${error}</p>
        <script>window.opener?.postMessage({type:'oauth_error',provider:'spotify',error:'${error}'},'*');setTimeout(()=>window.close(),2000);</script>
      </div>
    </body></html>`)
    return
  }

  if (!state || !code) {
    res.status(400).send('<html><body><p>Missing code or state</p></body></html>')
    return
  }

  const pending = pendingStates.get(state)
  if (!pending || pending.expiresAt < Date.now()) {
    pendingStates.delete(state)
    res.status(400).send('<html><body><p>Invalid or expired OAuth state. Please try again.</p></body></html>')
    return
  }

  pendingStates.delete(state)
  const { userId } = pending

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    res.status(503).send('<html><body><p>Spotify credentials not configured</p></body></html>')
    return
  }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      console.error('[OAuth] Spotify token exchange failed', body)
      res.status(502).send('<html><body><p>Failed to exchange code for tokens. Please try again.</p></body></html>')
      return
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope?: string
    }

    console.log(`[OAuth] Spotify token exchange success — scopes: ${tokens.scope ?? 'not returned'}, expires_in: ${tokens.expires_in}`)

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    await prisma.oAuthToken.upsert({
      where: { userId_provider: { userId, provider: 'spotify' } },
      update: {
        accessToken: tokens.access_token,
        expiresAt,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      },
      create: {
        userId,
        provider: 'spotify',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt,
      },
    })

    res.send(`<!DOCTYPE html><html><head><title>Spotify Connected</title></head>
    <body style="font-family:system-ui;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center;padding:24px;background:#282828;border-radius:12px">
        <div style="font-size:48px;margin-bottom:12px">🎵</div>
        <h2 style="color:#1db954;margin-bottom:8px">Spotify Connected!</h2>
        <p style="color:#b3b3b3">Closing window...</p>
      </div>
      <script>
        window.opener?.postMessage({ type: 'oauth_complete', provider: 'spotify' }, '*');
        setTimeout(() => window.close(), 1500);
      </script>
    </body></html>`)
  } catch (err) {
    console.error('[OAuth] Spotify callback error', err)
    res.status(500).send('<html><body><p>Internal error during OAuth callback. Please try again.</p></body></html>')
  }
})

export default router
