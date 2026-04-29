import { describe, expect, it } from 'vitest'
import { nativeMediaUrl, nativeQuestionPathUrl, nativeQuestionUrl } from './native-qbank'

describe('native qbank urls', () => {
  it('preserves revision query strings after appending native paths', () => {
    const basePath = '/api/study-packs/pack-1/file?rev=7'

    expect(nativeQuestionUrl(basePath, 'peds.sample.s001.q01')).toBe('/api/study-packs/pack-1/file/questions/peds.sample.s001.q01.json?rev=7')
    expect(nativeQuestionPathUrl(basePath, 'questions/peds.sample.s001.q01.json')).toBe('/api/study-packs/pack-1/file/questions/peds.sample.s001.q01.json?rev=7')
    expect(nativeMediaUrl(basePath, 'media/stem.svg')).toBe('/api/study-packs/pack-1/file/media/stem.svg?rev=7')
  })
})
