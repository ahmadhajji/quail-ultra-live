import crypto from 'node:crypto'
import { parse, serialize } from 'cookie'
import type { Response } from 'express'
import { SESSION_COOKIE_NAME, SESSION_SECRET, shouldUseSecureCookies } from './config'

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
}

export function createSessionToken(userId: string): string {
  const payload = JSON.stringify({
    userId,
    issuedAt: Date.now()
  })
  const encodedPayload = toBase64Url(payload)
  const signature = signPayload(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifySessionToken(token: string | undefined | null): { userId: string } | null {
  if (!token || typeof token !== 'string') {
    return null
  }
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) {
    return null
  }

  const expected = signPayload(encodedPayload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed.userId !== 'string' || !parsed.userId) {
      return null
    }
    return { userId: parsed.userId }
  } catch (_error) {
    return null
  }
}

export function readSessionUserId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null
  }
  const cookies = parse(cookieHeader)
  return verifySessionToken(cookies[SESSION_COOKIE_NAME])?.userId ?? null
}

export function setSessionCookie(res: Response, userId: string): void {
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(),
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  }))
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(),
    path: '/',
    expires: new Date(0)
  }))
}
