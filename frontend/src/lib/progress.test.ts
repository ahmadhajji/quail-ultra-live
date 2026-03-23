import { describe, expect, it } from 'vitest'
import { createEmptyQuestionState, deriveBlockMode, getNextBlockKey, normalizeBlockRecord, normalizeProgress } from './progress'

describe('progress helpers', () => {
  it('derives block mode from legacy fields', () => {
    expect(deriveBlockMode({ timelimit: 120 })).toBe('timed')
    expect(deriveBlockMode({ showans: true })).toBe('tutor')
    expect(deriveBlockMode({})).toBe('untimed')
  })

  it('normalizes legacy block records safely', () => {
    const block = normalizeBlockRecord({
      blockqlist: ['1', '2'],
      answers: ['A'],
      complete: false,
      showans: true
    }, {
      '1': { options: ['A', 'B'], correct: 'A' },
      '2': { options: ['A', 'B'], correct: 'B' }
    })

    expect(block.mode).toBe('tutor')
    expect(block.answers).toEqual(['A', ''])
    expect(block.questionStates[0]).toEqual({
      submitted: true,
      revealed: true,
      correct: true,
      eliminatedChoices: []
    })
    expect(block.questionStates[1]).toEqual(createEmptyQuestionState())
  })

  it('normalizes progress and avoids reusing deleted block ids', () => {
    const progress = normalizeProgress({
      blockhist: {
        '1': {
          blockqlist: ['1'],
          answers: ['A']
        }
      }
    }, {
      index: { '1': { '0': 'General' } },
      tagnames: { tagnames: { '0': 'System' } },
      choices: { '1': { options: ['A'], correct: 'A' } }
    })

    expect(progress.blockhist['1']?.mode).toBe('untimed')
    expect(getNextBlockKey({
      ...progress,
      blockhist: {
        '1': progress.blockhist['1']!,
        '4': progress.blockhist['1']!
      }
    })).toBe('5')
  })
})
