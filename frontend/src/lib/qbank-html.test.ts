import { describe, expect, it } from 'vitest'
import { buildPackFileUrl } from './api'
import { extractChoiceLabels, rewriteAssetPaths, sanitizeLegacyHtml, stripChoicesFromQuestionDisplay } from './qbank-html'

describe('qbank html helpers', () => {
  it('extracts answer labels from embedded question markup', () => {
    const html = '<div>What is the diagnosis?<br>A. First option<br>B. Second option<br>C. Third option</div>'
    expect(extractChoiceLabels(html)).toEqual({
      A: 'First option',
      B: 'Second option',
      C: 'Third option'
    })
  })

  it('strips duplicate choice rows from the rendered question stem', () => {
    const html = '<div>Prompt text<br>A. First option<br>B. Second option</div><p>Follow-up clue.</p>'
    const stripped = stripChoicesFromQuestionDisplay(html)
    expect(stripped).toContain('Prompt text')
    expect(stripped).toContain('Follow-up clue.')
    expect(stripped).not.toContain('Second option')
  })

  it('sanitizes legacy markup at the render boundary', () => {
    const html = sanitizeLegacyHtml('<p onclick="alert(1)" style="color:red">Safe <script>alert(1)</script><a href="javascript:alert(1)">bad</a><iframe src="/x"></iframe></p>')
    expect(html).toContain('Safe')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<script')
  })

  it('preserves safe qbank media while stripping hostile data urls', () => {
    const html = rewriteAssetPaths('<img src="images/cxr.png"><img src="data:image/svg+xml;base64,PHN2Zy8+"><audio src="clip.mp3" controls></audio>', '/api/study-packs/pack-1/file?rev=3', '240px')
    expect(html).toContain('/api/study-packs/pack-1/file/images/cxr.png?rev=3')
    expect(html).toContain('data-openable-image="true"')
    expect(html).toContain('/api/study-packs/pack-1/file/clip.mp3?rev=3')
    expect(html).not.toContain('data:image/svg+xml')
  })

  it('drops imported content references that escape the pack boundary', () => {
    const html = rewriteAssetPaths([
      '<img src="/api/admin/users">',
      '<img src="../secret.png">',
      '<img src="images//x.png">',
      '<img src="https://example.test/x.png">',
      '<audio src="//example.test/x.mp3"></audio>',
      '<a href="/api/admin/users">admin</a>'
    ].join(''), '/api/study-packs/pack-1/file?rev=3', '240px')

    expect(html).not.toContain('/api/admin/users')
    expect(html).not.toContain('../secret.png')
    expect(html).not.toContain('images//x.png')
    expect(html).not.toContain('example.test')
  })

  it('builds revision-aware pack file URLs', () => {
    expect(buildPackFileUrl('pack-1', 'media/q01.png', 7)).toBe('/api/study-packs/pack-1/file/media/q01.png?rev=7')
  })
})
