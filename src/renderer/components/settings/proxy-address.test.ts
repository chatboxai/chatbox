import { describe, expect, it } from 'vitest'
import { isValidProxyAddress } from './proxy-address'

describe('isValidProxyAddress', () => {
  it('accepts proxy URIs with or without a scheme', () => {
    expect(isValidProxyAddress('socks5://127.0.0.1:6153')).toBe(true)
    expect(isValidProxyAddress('http://proxy.local:8080')).toBe(true)
    expect(isValidProxyAddress('https://user:pass@proxy.example.com:443')).toBe(true)
    expect(isValidProxyAddress('127.0.0.1:7890')).toBe(true)
    expect(isValidProxyAddress('proxy.local')).toBe(true)
    expect(isValidProxyAddress('http://[2001:db8::1]:8080')).toBe(true)
    expect(isValidProxyAddress('[::1]:1080')).toBe(true)
  })

  it('accepts per-scheme rules and fallback lists', () => {
    expect(isValidProxyAddress('http=proxy:8080;https=proxy:8443')).toBe(true)
    expect(isValidProxyAddress('http=foopy:80;ftp=foopy2')).toBe(true)
    expect(isValidProxyAddress('socks4://foopy,direct://')).toBe(true)
  })

  it('treats an empty value as a direct connection', () => {
    expect(isValidProxyAddress('')).toBe(true)
  })

  it('rejects text that is not a proxy rule', () => {
    expect(isValidProxyAddress('socks5://')).toBe(false)
    expect(isValidProxyAddress('ftp://proxy.local:21')).toBe(false)
    expect(isValidProxyAddress('proxy local')).toBe(false)
    expect(isValidProxyAddress('http=;https=proxy')).toBe(false)
    expect(isValidProxyAddress('proxy:8080;')).toBe(false)
  })
})
