import { describe, expect, it } from 'vitest'
import { createEmptyQuestionState, deleteBlock, deriveBlockMode, getNextBlockKey, normalizeBlockRecord, normalizeProgress, startBlock } from './progress'

describe('shared progress helpers', () => {
  it('derives block mode from legacy fields', () => {
    expect(deriveBlockMode({ timelimit: 120 })).toBe('tutor')
    expect(deriveBlockMode({ showans: true })).toBe('tutor')
    expect(deriveBlockMode({})).toBe('tutor')
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
      visited: true,
      eliminatedChoices: []
    })
    expect(block.questionStates[1]).toEqual(createEmptyQuestionState())
  })

  it('derives visited state from saved question activity', () => {
    const block = normalizeBlockRecord({
      blockqlist: ['1', '2', '3'],
      answers: ['A', '', ''],
      notes: ['', 'Saved note', ''],
      highlights: ['[]', '[]', '{"v":1,"question":[{"id":"hl_1","start":0,"end":4,"color":"yellow"}],"explanation":[]}'],
      currentquesnum: 2
    }, {
      '1': { options: ['A', 'B'], correct: 'A' },
      '2': { options: ['A', 'B'], correct: 'B' },
      '3': { options: ['A', 'B'], correct: 'B' }
    })

    expect(block.questionStates.map((state) => state.visited)).toEqual([true, true, true])
  })

  it('drops legacy highlight tuples when deriving visited state', () => {
    const block = normalizeBlockRecord({
      blockqlist: ['1'],
      highlights: ['[["wrapper","text","0",0,4]]']
    }, {
      '1': { options: ['A', 'B'], correct: 'A' }
    })

    expect(block.questionStates[0]?.visited).toBe(false)
  })

  it('creates and deletes blocks without reusing ids', () => {
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

    expect(getNextBlockKey({
      ...progress,
      blockhist: {
        '1': progress.blockhist['1']!,
        '4': progress.blockhist['1']!
      }
    })).toBe('5')

    const qbankinfo = {
      index: { '1': { '0': 'General' } },
      tagnames: { tagnames: { '0': 'System' } },
      choices: { '1': { options: ['A'], correct: 'A' } },
      progress
    }

    const blockKey = startBlock(qbankinfo, ['1'], { qpoolstr: 'Unused' })
    expect(progress.blockhist[blockKey]?.blockqlist).toEqual(['1'])

    deleteBlock(qbankinfo, blockKey)
    expect(progress.blockhist[blockKey]).toBeUndefined()
  })
})
