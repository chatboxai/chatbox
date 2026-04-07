import request from 'supertest'
import jwt from 'jsonwebtoken'
import { app } from '../index'
import { generateToken, generateExpiredToken } from './helpers'

const FAKE_USER_ID = 'test-user-00000000'
// GET /api/conversations is a protected endpoint — use it as the auth probe
const PROTECTED = '/api/conversations'

describe('requireAuth middleware', () => {
  it('allows request with valid JWT in Authorization header → not 401', async () => {
    const token = generateToken(FAKE_USER_ID)
    const res = await request(app).get(PROTECTED).set('Authorization', `Bearer ${token}`)

    expect(res.status).not.toBe(401)
  })

  it('rejects request with no Authorization header → 401', async () => {
    const res = await request(app).get(PROTECTED)

    expect(res.status).toBe(401)
    expect(res.body.error).toBeDefined()
  })

  it('rejects request with invalid JWT → 401', async () => {
    const res = await request(app)
      .get(PROTECTED)
      .set('Authorization', 'Bearer not.a.valid.token')

    expect(res.status).toBe(401)
  })

  it('rejects request with JWT signed with wrong secret → 401', async () => {
    const wrongToken = jwt.sign({ userId: FAKE_USER_ID }, 'wrong-secret', { expiresIn: '1h' })
    const res = await request(app)
      .get(PROTECTED)
      .set('Authorization', `Bearer ${wrongToken}`)

    expect(res.status).toBe(401)
  })

  it('rejects request with expired JWT → 401', async () => {
    const expiredToken = generateExpiredToken(FAKE_USER_ID)
    const res = await request(app)
      .get(PROTECTED)
      .set('Authorization', `Bearer ${expiredToken}`)

    expect(res.status).toBe(401)
  })

  it('rejects malformed Bearer header (no token) → 401', async () => {
    const res = await request(app).get(PROTECTED).set('Authorization', 'Bearer ')

    expect(res.status).toBe(401)
  })
})
