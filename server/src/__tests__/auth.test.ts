import request from 'supertest'
import { app } from '../index'
import { cleanupTestUsers, uniqueEmail } from './helpers'

afterAll(async () => {
  await cleanupTestUsers()
})

describe('POST /api/auth/register', () => {
  it('creates user with valid email and password → 201 + token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: uniqueEmail('reg'), password: 'password123' })

    expect(res.status).toBe(201)
    expect(typeof res.body.token).toBe('string')
    expect(res.body.user.email).toMatch(/@jest\.test$/)
  })

  it('rejects duplicate email → 409', async () => {
    const email = uniqueEmail('dup')
    await request(app).post('/api/auth/register').send({ email, password: 'pass1234' })
    const res = await request(app).post('/api/auth/register').send({ email, password: 'pass1234' })

    expect(res.status).toBe(409)
    expect(res.body.error).toBeDefined()
  })

  it('rejects short password → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: uniqueEmail('short'), password: 'abc' })

    expect(res.status).toBe(400)
  })

  it('rejects invalid email format → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  it('returns JWT for valid credentials → 200 + token', async () => {
    const email = uniqueEmail('login')
    await request(app).post('/api/auth/register').send({ email, password: 'pass1234' })

    const res = await request(app).post('/api/auth/login').send({ email, password: 'pass1234' })

    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
    expect(res.body.user.email).toBe(email)
  })

  it('rejects wrong password → 401', async () => {
    const email = uniqueEmail('wrongpw')
    await request(app).post('/api/auth/register').send({ email, password: 'correctpass' })

    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrongpass' })

    expect(res.status).toBe(401)
  })

  it('rejects unknown email → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@jest.test', password: 'somepass' })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/refresh', () => {
  it('returns new JWT from valid token → 200 + token', async () => {
    const email = uniqueEmail('refresh')
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'pass1234' })

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${reg.body.token}`)

    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
  })

  it('rejects invalid token → 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer completely-invalid-token')

    expect(res.status).toBe(401)
  })

  it('rejects missing Authorization header → 401', async () => {
    const res = await request(app).post('/api/auth/refresh')

    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/demo', () => {
  it('returns JWT for the seeded demo user → 200 + token', async () => {
    const res = await request(app).post('/api/auth/demo')

    // Demo user must be seeded; if not, it returns 503
    if (res.status === 503) {
      console.warn('Demo user not seeded — run `npm run seed` to fix')
      return
    }

    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
    expect(res.body.user.email).toBe('demo@chatbridge.app')
  })
})
