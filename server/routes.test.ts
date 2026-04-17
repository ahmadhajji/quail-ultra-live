import { describe, expect, it } from 'vitest'
import { legacyPageRedirectTarget, routePathFor } from './routes'

describe('server route helpers', () => {
  it('maps app routes to clean SPA paths', () => {
    expect(routePathFor('study-packs')).toBe('/')
    expect(routePathFor('overview')).toBe('/overview')
    expect(routePathFor('examview')).toBe('/examview')
  })

  it('maps legacy html pages to SPA targets', () => {
    expect(legacyPageRedirectTarget('overview')).toBe('/overview')
    expect(legacyPageRedirectTarget('loadbank')).toBe('/')
  })
})
