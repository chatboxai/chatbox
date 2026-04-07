import request from 'supertest'
import { app } from '../index'
import { prisma } from '../lib/prisma'
import { cleanupTestUsers, generateToken, uniqueEmail } from './helpers'

let authToken: string

beforeAll(async () => {
  // Create a test user and get a token for authenticated requests
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: uniqueEmail('apps'), password: 'password123' })
  authToken = res.body.token
})

afterAll(async () => {
  // Clean up test app registrations (not seeded ones)
  await prisma.appRegistration.deleteMany({
    where: {
      OR: [
        { name: { startsWith: 'Test Dynamic' } },
        { name: { startsWith: 'Test Admin' } },
      ],
    },
  })
  await cleanupTestUsers()
})

describe('GET /api/apps', () => {
  it('returns an array of approved apps', async () => {
    const res = await request(app).get('/api/apps')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('includes chess, weather, and spotify apps', async () => {
    const res = await request(app).get('/api/apps')
    const names: string[] = res.body.map((a: { name: string }) => a.name.toLowerCase())

    expect(names).toContain('chess')
    expect(names).toContain('weather')
    expect(names).toContain('spotify')
  })

  it('each app has name, url, description, and tools array', async () => {
    const res = await request(app).get('/api/apps')

    for (const app of res.body as Array<Record<string, unknown>>) {
      expect(typeof app.name).toBe('string')
      expect(typeof app.url).toBe('string')
      expect(typeof app.description).toBe('string')
      expect(Array.isArray(app.tools)).toBe(true)
    }
  })

  it('each tool has name, description, and parameters', async () => {
    const res = await request(app).get('/api/apps')

    for (const app of res.body as Array<{ tools: Array<Record<string, unknown>> }>) {
      for (const tool of app.tools) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.parameters).toBe('object')
      }
    }
  })

  it('all returned apps have status approved', async () => {
    const res = await request(app).get('/api/apps')

    for (const app of res.body as Array<{ status: string }>) {
      expect(app.status).toBe('approved')
    }
  })
})

describe('POST /api/apps/register', () => {
  it('returns 201 with status pending', async () => {
    const res = await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Dynamic App',
        url: 'https://example.com/test-app',
        description: 'A dynamically registered test app',
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.status).toBe('pending')
  })

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/apps/register')
      .send({
        name: 'Test Dynamic Unauth',
        url: 'https://example.com/unauth',
        description: 'Should fail',
        tools: [
          {
            name: 'tool',
            description: 'tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/apps excludes pending apps', () => {
  it('newly registered app does not appear in GET /api/apps', async () => {
    // Register a new app (status: pending)
    const registerRes = await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Dynamic Pending',
        url: 'https://example.com/pending',
        description: 'This should not appear',
        tools: [
          {
            name: 'pending_tool',
            description: 'A pending tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })
    expect(registerRes.status).toBe(201)

    // GET should not include the pending app
    const listRes = await request(app).get('/api/apps')
    const names = listRes.body.map((a: { name: string }) => a.name)
    expect(names).not.toContain('Test Dynamic Pending')
  })
})

describe('PATCH /api/apps/:id/status', () => {
  it('updates status to approved and app appears in GET', async () => {
    // Register a new app
    const registerRes = await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Dynamic Approve',
        url: 'https://example.com/approve',
        description: 'Will be approved',
        tools: [
          {
            name: 'approve_tool',
            description: 'A tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })
    const appId = registerRes.body.id

    // Approve it
    const patchRes = await request(app)
      .patch(`/api/apps/${appId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'approved' })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body.status).toBe('approved')

    // GET should now include it
    const listRes = await request(app).get('/api/apps')
    const names = listRes.body.map((a: { name: string }) => a.name)
    expect(names).toContain('Test Dynamic Approve')
  })

  it('returns 404 for nonexistent app ID', async () => {
    const res = await request(app)
      .patch('/api/apps/nonexistent-uuid/status')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'approved' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
  })
})

describe('GET /api/apps/all', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/apps/all')
    expect(res.status).toBe(401)
  })

  it('returns apps including pending ones', async () => {
    // Register a new app (status: pending)
    const registerRes = await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Admin Pending',
        url: 'https://example.com/admin-pending',
        description: 'A pending app for admin test',
        tools: [
          {
            name: 'admin_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })
    expect(registerRes.status).toBe(201)

    const res = await request(app)
      .get('/api/apps/all')
      .set('Authorization', `Bearer ${authToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.apps)).toBe(true)
    const names = res.body.apps.map((a: { name: string }) => a.name)
    expect(names).toContain('Test Admin Pending')
  })

  it('each app has a status field', async () => {
    const res = await request(app)
      .get('/api/apps/all')
      .set('Authorization', `Bearer ${authToken}`)

    expect(res.status).toBe(200)
    for (const appItem of res.body.apps as Array<Record<string, unknown>>) {
      expect(appItem.status).toBeDefined()
      expect(['pending', 'approved', 'rejected']).toContain(appItem.status)
    }
  })

  it('returns apps of all statuses', async () => {
    // Register an app and approve it
    const approveRes = await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Admin Approved',
        url: 'https://example.com/admin-approved',
        description: 'An approved app for admin test',
        tools: [
          {
            name: 'approved_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })
    const approvedId = approveRes.body.id
    await request(app)
      .patch(`/api/apps/${approvedId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'approved' })

    // Register another app (stays pending)
    await request(app)
      .post('/api/apps/register')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Admin Still Pending',
        url: 'https://example.com/admin-still-pending',
        description: 'Still pending',
        tools: [
          {
            name: 'pending_tool_2',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })

    const res = await request(app)
      .get('/api/apps/all')
      .set('Authorization', `Bearer ${authToken}`)

    expect(res.status).toBe(200)
    const statuses = res.body.apps.map((a: { status: string }) => a.status)
    expect(statuses).toContain('approved')
    expect(statuses).toContain('pending')
  })

  it('each app has id, name, url, description, tools, and status', async () => {
    const res = await request(app)
      .get('/api/apps/all')
      .set('Authorization', `Bearer ${authToken}`)

    expect(res.status).toBe(200)
    for (const appItem of res.body.apps as Array<Record<string, unknown>>) {
      expect(typeof appItem.id).toBe('string')
      expect(typeof appItem.name).toBe('string')
      expect(typeof appItem.url).toBe('string')
      expect(typeof appItem.description).toBe('string')
      expect(Array.isArray(appItem.tools)).toBe(true)
      expect(typeof appItem.status).toBe('string')
    }
  })
})
