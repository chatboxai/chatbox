import 'dotenv/config'
import express from 'express'
import { createServer, type IncomingMessage } from 'http'
import path from 'path'
import { WebSocketServer, type WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { prisma } from './lib/prisma'
import { handleWebSocketConnection } from './ws/chatHandler'
import appsRouter from './routes/apps'
import authRouter from './routes/auth'
import conversationsRouter from './routes/conversations'
import internalRouter from './routes/internal'
import oauthRouter from './routes/oauth'
import spotifyInternalRouter from './routes/spotify-internal'
import { requireAuth } from './middleware/auth'
import { authLimiter, apiLimiter } from './middleware/rateLimit'

// Fail fast on missing required env vars
const requiredEnvVars = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'JWT_SECRET'] as const
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`)
    process.exit(1)
  }
}

const JWT_SECRET = process.env.JWT_SECRET as string
const PORT = Number(process.env.PORT) || 3000

interface JwtPayload {
  userId: string
  iat?: number
  exp?: number
}

const app = express()

app.use(express.json())

// Rate limiters
app.use('/api/auth', authLimiter)
app.use('/api', apiLimiter)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Auth routes (public)
app.use('/api/auth', authRouter)

// App registry (public GET, auth required for POST/PATCH)
app.use('/api/apps', appsRouter)

// Conversations (all endpoints require auth)
app.use('/api/conversations', requireAuth, conversationsRouter)

// Internal API proxy (no auth — server-side key protection)
app.use('/api/internal', internalRouter)

// OAuth popup flow (public — JWT validated inside handler)
app.use('/api/oauth', oauthRouter)

// Spotify internal API (requires auth)
app.use('/api/internal/spotify', requireAuth, spotifyInternalRouter)

// Static: built SPAs (must come before the generic /apps catch-all)
app.use('/apps/weather', express.static(path.join(__dirname, '../../apps/weather/dist')))
app.use('/apps/chess', express.static(path.join(__dirname, '../../apps/chess/dist')))
app.use('/apps/spotify', express.static(path.join(__dirname, '../../apps/spotify/dist')))
// Static: demo apps and built frontend (populated in later milestones)
app.use('/apps', express.static(path.join(__dirname, '../../apps')))
app.use(express.static(path.join(__dirname, '../../release/app/dist/renderer')))

// SPA catch-all — serve Chatbox frontend for all unmatched routes (must be last)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../release/app/dist/renderer/index.html'))
})

const server = createServer(app)

// WebSocket server in noServer mode — auth happens in upgrade handler
const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws: WebSocket, _request: IncomingMessage, userId: string) => {
  console.log(`WebSocket connected: user=${userId}`)
  handleWebSocketConnection(ws, userId)
})

server.on('upgrade', (request, socket, head) => {
  socket.on('error', (err) => {
    console.error('Socket error during upgrade', err)
  })

  // Extract token from query string: ws://host/ws?token=JWT
  const url = new URL(request.url ?? '', `http://${request.headers.host}`)
  const token = url.searchParams.get('token')

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch (err) {
    console.warn('WebSocket auth failed — invalid token', err instanceof Error ? err.message : err)
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  socket.removeAllListeners('error')

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, payload.userId)
  })
})

// Export for supertest (HTTP tests) and WebSocket tests
export { app, server }

// Verify DB connectivity and start listening
async function start(): Promise<void> {
  try {
    await prisma.$connect()
    console.log('Database connected')
  } catch (error) {
    console.error('Database connection failed', error)
    process.exit(1)
  }

  server.listen(PORT, () => {
    console.log(`ChatBridge server listening on port ${PORT}`)
    console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'}`)
    console.log(`JWT_SECRET: ${process.env.JWT_SECRET ? 'set' : 'MISSING'}`)
  })
}

// Only auto-start when run directly (not when imported by tests)
if (require.main === module) {
  void start()
}
