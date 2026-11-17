import { describe, expect, it } from 'vitest'
import { modelEndpointLocation } from './-modelSource'

describe('model service location', () => {
  it.each(['http://localhost:11434', 'http://127.0.0.1:1234/v1', 'http://[::1]:11434', 'http://127.0.0.2'])(
    'identifies a loopback service: %s',
    (endpoint) => {
      expect(modelEndpointLocation(endpoint, false)).toBe('Local service · This device')
    }
  )
  it.each([
    'https://api.example.com',
    'http://192.168.1.2:11434',
    'https://localhost.example.com',
    'https://127.example.com',
  ])('does not call a remote host local: %s', (endpoint) => {
    expect(modelEndpointLocation(endpoint, false)).toBe('Remote service')
  })
  it('does not assume an unconfigured endpoint is local', () => {
    expect(modelEndpointLocation(undefined, false)).toBe('Provider-managed service')
    expect(modelEndpointLocation('invalid', false)).toBe('Check provider endpoint')
    expect(modelEndpointLocation('file:///tmp/model', false)).toBe('Check provider endpoint')
    expect(modelEndpointLocation(undefined, true)).toBe('Remote · Chatbox AI')
  })
})
