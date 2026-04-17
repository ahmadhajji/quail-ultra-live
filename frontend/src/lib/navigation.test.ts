import { describe, expect, it } from 'vitest'
import { buildPageUrl } from './navigation'

describe('navigation helpers', () => {
  it('builds clean SPA urls with query params', () => {
    window.history.replaceState({}, '', '/')
    expect(buildPageUrl('index')).toBe('/')
    expect(buildPageUrl('overview', { pack: 'pack-1' })).toBe('/overview?pack=pack-1')
    expect(buildPageUrl('examview', { pack: 'pack-1', block: '4' })).toBe('/examview?pack=pack-1&block=4')
  })
})
