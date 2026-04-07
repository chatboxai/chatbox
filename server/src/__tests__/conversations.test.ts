import request from 'supertest'
import { app } from '../index'
import { prisma } from '../lib/prisma'
import { generateToken, cleanupTestUsers, uniqueEmail } from './helpers'
import bcrypt from 'bcrypt'

let token: string
let userId: string

beforeAll(async () => {
  // Create a dedicated test user for conversation tests
  const email = uniqueEmail('conv')
  const passwordHash = await bcrypt.hash('testpass123', 10)
  const user = await prisma.user.create({ data: { email, passwordHash } })
  userId = user.id
  token = generateToken(userId)
})

afterAll(async () => {
  // Clean up conversations first (messages → conversations), then users
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    select: { id: true },
  })
  const convIds = conversations.map((c) => c.id)
  await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
  await prisma.conversation.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  // Clean up any other test users created by auth tests
  await cleanupTestUsers()
})

describe('POST /api/conversations', () => {
  it('creates a new conversation → 201 + id + title', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Chat' })

    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe('string')
    expect(res.body.title).toBe('Test Chat')
  })

  it('creates conversation with default title when omitted → 201', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe('string')
  })

  it('requires authentication → 401', async () => {
    const res = await request(app).post('/api/conversations').send({ title: 'No auth' })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/conversations', () => {
  it('returns list of conversations for authenticated user → 200', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(typeof res.body.conversations).toBe('object')
    expect(Array.isArray(res.body.conversations)).toBe(true)
  })

  it('requires authentication → 401', async () => {
    const res = await request(app).get('/api/conversations')

    expect(res.status).toBe(401)
  })
})

describe('GET /api/conversations/:id', () => {
  let conversationId: string

  beforeAll(async () => {
    const created = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Detail Test' })
    conversationId = created.body.id
  })

  it('returns conversation with messages array → 200', async () => {
    const res = await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(conversationId)
    expect(Array.isArray(res.body.messages)).toBe(true)
  })

  it('returns 404 for non-existent conversation', async () => {
    const res = await request(app)
      .get('/api/conversations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('requires authentication → 401', async () => {
    const res = await request(app).get(`/api/conversations/${conversationId}`)

    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/conversations/:id', () => {
  it('deletes owned conversation → 204', async () => {
    const created = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To Delete' })

    const res = await request(app)
      .delete(`/api/conversations/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)
  })

  it('returns 404 when conversation does not exist', async () => {
    const res = await request(app)
      .delete('/api/conversations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
