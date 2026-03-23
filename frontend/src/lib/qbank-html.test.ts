import { describe, expect, it } from 'vitest'
import { extractChoiceLabels, stripChoicesFromQuestionDisplay } from './qbank-html'

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
})
