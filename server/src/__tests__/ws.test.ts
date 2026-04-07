import WebSocket from 'ws'
import { AddressInfo } from 'net'
import { server } from '../index'
import { generateToken, generateExpiredToken } from './helpers'

const FAKE_USER_ID = 'test-ws-user-00000000'
let testPort: number

beforeAll((done) => {
  // Listen on a random port so we don't conflict with the dev server
  server.listen(0, () => {
    testPort = (server.address() as AddressInfo).port
    done()
  })
})

afterAll((done) => {
  server.close(done)
})

function wsUrl(token?: string): string {
  const base = `ws://127.0.0.1:${testPort}/ws`
  return token ? `${base}?token=${token}` : base
}

/** Helper: wrap done to prevent "called multiple times" when both
 *  unexpected-response AND error events fire for a rejected connection. */
function onceDone(done: jest.DoneCallback): (err?: Error) => void {
  let called = false
  return (err?: Error) => {
    if (!called) {
      called = true
      done(err)
    }
  }
}

describe('WebSocket authentication', () => {
  it('accepts connection with valid JWT', (done) => {
    const token = generateToken(FAKE_USER_ID)
    const ws = new WebSocket(wsUrl(token))

    ws.on('open', () => {
      ws.close()
      done()
    })
    ws.on('error', (err) => done(err))
  })

  it('rejects connection without token (no query string) → HTTP 401', (done) => {
    const finish = onceDone(done)
    const ws = new WebSocket(wsUrl())

    ws.on('unexpected-response', (_req, res) => {
      expect(res.statusCode).toBe(401)
      ws.terminate()
      finish()
    })
    ws.on('open', () => finish(new Error('Expected rejection but connection was accepted')))
    // ws may also emit 'error' after unexpected-response — guard prevents double-done
    ws.on('error', () => finish())
  })

  it('rejects connection with invalid JWT → HTTP 401', (done) => {
    const finish = onceDone(done)
    const ws = new WebSocket(wsUrl('this-is-not-a-jwt'))

    ws.on('unexpected-response', (_req, res) => {
      expect(res.statusCode).toBe(401)
      ws.terminate()
      finish()
    })
    ws.on('open', () => finish(new Error('Expected rejection but connection was accepted')))
    ws.on('error', () => finish())
  })

  it('rejects connection with expired JWT → HTTP 401', (done) => {
    const finish = onceDone(done)
    const expiredToken = generateExpiredToken(FAKE_USER_ID)
    const ws = new WebSocket(wsUrl(expiredToken))

    ws.on('unexpected-response', (_req, res) => {
      expect(res.statusCode).toBe(401)
      ws.terminate()
      finish()
    })
    ws.on('open', () => finish(new Error('Expected rejection but connection was accepted')))
    ws.on('error', () => finish())
  })
})
