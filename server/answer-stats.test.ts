import { describe, expect, it } from 'vitest'
import { buildQuestionStats, collectNewlySubmittedAnswers } from './answer-stats'

describe('answer stats helpers', () => {
  it('collects only newly submitted non-empty answers', () => {
    const previousProgress = {
      blockhist: {
        '0': {
          blockqlist: ['101', '102'],
          answers: ['B', 'C'],
          questionStates: [
            { submitted: false },
            { submitted: true }
          ]
        }
      }
    }
    const nextProgress = {
      blockhist: {
        '0': {
          blockqlist: ['101', '102', '103'],
          answers: ['B', 'C', ''],
          questionStates: [
            { submitted: true },
            { submitted: true },
            { submitted: true }
          ]
        }
      }
    }

    expect(collectNewlySubmittedAnswers({
      systemPackId: 'system-1',
      userId: 'user-1',
      previousProgress,
      nextProgress,
      choices: {
        '101': { correct: 'B' },
        '102': { correct: 'A' },
        '103': { correct: 'C' }
      },
      answeredAt: '2026-01-01T00:00:00.000Z'
    })).toEqual([{
      systemPackId: 'system-1',
      questionId: '101',
      userId: 'user-1',
      selectedChoice: 'B',
      correctChoice: 'B',
      answeredAt: '2026-01-01T00:00:00.000Z'
    }])
  })

  it('hides counts and percentages below the minimum peer threshold', () => {
    const stats = buildQuestionStats({
      ids: ['101'],
      eligible: true,
      choices: {
        '101': { options: ['A', 'B', 'C'], correct: 'B' }
      },
      rows: [
        { question_id: '101', selected_choice: 'B', answer_count: 2 }
      ]
    })

    expect(stats['101']).toMatchObject({
      eligible: true,
      peerCount: 2,
      correctPercent: null,
      choices: {
        A: { count: null, percent: null },
        B: { count: null, percent: null },
        C: { count: null, percent: null }
      }
    })
  })

  it('returns rounded percentages when enough peers exist', () => {
    const stats = buildQuestionStats({
      ids: ['101'],
      eligible: true,
      choices: {
        '101': { options: ['A', 'B', 'C'], correct: 'B' }
      },
      rows: [
        { question_id: '101', selected_choice: 'A', answer_count: 1 },
        { question_id: '101', selected_choice: 'B', answer_count: 2 }
      ]
    })

    expect(stats['101']).toMatchObject({
      eligible: true,
      peerCount: 3,
      correctChoice: 'B',
      correctPercent: 67,
      choices: {
        A: { count: 1, percent: 33 },
        B: { count: 2, percent: 67 },
        C: { count: 0, percent: 0 }
      }
    })
  })
})
