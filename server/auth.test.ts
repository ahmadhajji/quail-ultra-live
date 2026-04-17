import { describe, expect, it } from 'vitest'
import { createSessionToken, readSessionUserId, verifySessionToken } from './auth'

describe('session auth helpers', () => {
  it('creates and verifies signed session tokens', () => {
    const token = createSessionToken('user-123')
    expect(verifySessionToken(token)).toEqual({ userId: 'user-123' })
  })

  it('extracts the signed session from a cookie header', () => {
    const token = createSessionToken('user-456')
    expect(readSessionUserId(`quail_session=${token}`)).toBe('user-456')
  })
})
