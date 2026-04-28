import { describe, expect, it } from 'vitest'
import { questionStatsResponseSchema } from './schemas'

describe('question stats schema', () => {
  it('accepts nullable protected stats and visible percentages', () => {
    const parsed = questionStatsResponseSchema.parse({
      stats: {
        '101': {
          eligible: true,
          peerCount: 3,
          minPeerCount: 3,
          correctChoice: 'B',
          correctPercent: 67,
          choices: {
            A: { count: 1, percent: 33 },
            B: { count: 2, percent: 67 }
          }
        },
        '102': {
          eligible: true,
          peerCount: 1,
          minPeerCount: 3,
          correctChoice: 'A',
          correctPercent: null,
          choices: {
            A: { count: null, percent: null }
          }
        }
      }
    })
    expect(parsed.stats['101']!.choices.B!.percent).toBe(67)
  })

  it('rejects malformed choice percentages', () => {
    expect(() => questionStatsResponseSchema.parse({
      stats: {
        '101': {
          eligible: true,
          peerCount: 3,
          minPeerCount: 3,
          correctChoice: 'B',
          correctPercent: 67,
          choices: {
            A: { count: 1, percent: '33%' }
          }
        }
      }
    })).toThrow()
  })
})
