import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  // --- Demo user ---
  const email = 'demo@chatbridge.app'
  const password = 'demo123'

  const existingUser = await prisma.user.findUnique({ where: { email } })

  let userId: string

  if (existingUser) {
    console.log(`Demo user already exists: ${email}`)
    userId = existingUser.id
  } else {
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, passwordHash },
    })
    userId = user.id
    console.log(`Created demo user: ${email} (id: ${userId})`)
  }

  // --- App registrations ---
  const testApp = await prisma.appRegistration.upsert({
    where: { id: 'test-app' },
    update: { status: 'approved' },
    create: {
      id: 'test-app',
      name: 'Test App',
      url: '/apps/test-app',
      description: 'Protocol compliance test fixture',
      toolSchemas: [
        {
          name: 'dummy_action',
          description: 'A test tool that always succeeds',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Optional message' },
            },
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${testApp.name} (${testApp.status})`)

  const chessApp = await prisma.appRegistration.upsert({
    where: { id: 'chess' },
    update: { status: 'approved' },
    create: {
      id: 'chess',
      name: 'Chess',
      url: '/apps/chess',
      description:
        'Interactive chess game with AI analysis. Play chess against yourself or get move suggestions from Claude.',
      toolSchemas: [
        {
          name: 'start_game',
          description: 'Start a new chess game',
          parameters: {
            type: 'object',
            properties: {
              color: { type: 'string', enum: ['white', 'black'] },
            },
          },
        },
        {
          name: 'make_move',
          description: 'Make a chess move',
          parameters: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              promotion: { type: 'string', enum: ['q', 'r', 'b', 'n'] },
            },
            required: ['from', 'to'],
          },
        },
        {
          name: 'get_board_state',
          description: 'Get the current board position and game status',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${chessApp.name} (${chessApp.status})`)

  const weatherApp = await prisma.appRegistration.upsert({
    where: { id: 'weather' },
    update: { status: 'approved' },
    create: {
      id: 'weather',
      name: 'Weather',
      url: '/apps/weather',
      description:
        'Weather dashboard. Ask about current conditions or forecasts for any city.',
      toolSchemas: [
        {
          name: 'get_current_weather',
          description: 'Get the current weather conditions for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name, e.g. "Tokyo"' },
            },
            required: ['location'],
          },
        },
        {
          name: 'get_forecast',
          description: 'Get a multi-day weather forecast for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
              days: { type: 'number', description: 'Number of forecast days (default 4)' },
            },
            required: ['location'],
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${weatherApp.name} (${weatherApp.status})`)

  const spotifyApp = await prisma.appRegistration.upsert({
    where: { id: 'spotify' },
    update: { status: 'approved', authRequired: true, authProvider: 'spotify' },
    create: {
      id: 'spotify',
      name: 'Spotify',
      authRequired: true,
      authProvider: 'spotify',
      url: '/apps/spotify',
      description: 'Spotify playlist creator. Search for tracks and create playlists using natural language.',
      toolSchemas: [
        {
          name: 'search_tracks',
          description: 'Search for music tracks on Spotify',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results (default 5)' },
            },
            required: ['query'],
          },
        },
        {
          name: 'create_playlist',
          description: 'Create a Spotify playlist and add tracks to it',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Playlist name' },
              description: { type: 'string', description: 'Optional description' },
              trackQueries: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of search queries, one per track (e.g. ["Take Five Dave Brubeck", "Fly Me To The Moon Frank Sinatra"]). Must be an array, not a comma-separated string.',
              },
            },
            required: ['name', 'trackQueries'],
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${spotifyApp.name} (${spotifyApp.status})`)

  // --- Print dev JWT ---
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    console.error('JWT_SECRET not set — cannot generate test token')
    process.exit(1)
  }

  const token = jwt.sign({ userId }, jwtSecret, { expiresIn: '24h' })

  console.log('\n--- TEST JWT (valid 24h) ---')
  console.log(token)
  console.log('\nTest with wscat:')
  console.log(`  wscat -c 'ws://localhost:3000/ws?token=${token}'`)
  console.log('\nThen send:')
  console.log('  {"type":"user_message","conversationId":"test-123","content":"Hello, who are you?"}')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
