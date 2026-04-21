import type { QbankInfo } from '../types/domain'

export function createQbankInfoFixture(): QbankInfo {
  return {
    index: {
      '101': { '0': 'Cardiology', '1': 'Electrophysiology' },
      '102': { '0': 'Cardiology', '1': 'Electrophysiology' },
      '103': { '0': 'Cardiology', '1': 'Ischemia' }
    },
    tagnames: {
      tagnames: {
        '0': 'System',
        '1': 'Topic'
      }
    },
    choices: {
      '101': { options: ['A', 'B', 'C'], correct: 'B' },
      '102': { options: ['A', 'B', 'C'], correct: 'A' },
      '103': { options: ['A', 'B', 'C'], correct: 'C' }
    },
    groups: {
      '101': { next: '102' },
      '102': { prev: '101' }
    },
    panes: {
      Reference: { file: 'pane.html', prefs: 'width=600,height=400' }
    },
    questionMeta: {
      '101': {
        source: {
          deck_id: 'deck-1',
          slide_number: 12,
          question_index: 1,
          question_id: '12.1'
        },
        source_group_id: 'deck-1:12',
        source_slide: {
          asset_path: 'source-slides/deck-1__slide_12.png',
          expandable: true
        },
        slide_consensus: {
          status: 'consensus'
        },
        fact_check: {
          status: 'disputed',
          note: 'Flagged by fact-check.',
          sources: ['https://example.com/source'],
          model: 'gpt-5.4'
        },
        choice_text_by_letter: {
          A: 'Alpha',
          B: 'Bravo',
          C: 'Charlie'
        },
        choice_presentation: {
          shuffle_allowed: true,
          display_order: ['B', 'A', 'C']
        },
        warnings: ['Same-slide near-duplicate has a conflicting correct answer.'],
        related_qids: ['102'],
        dedupe_fingerprint: 'deck-1:12:abc123'
      }
    },
    progress: {
      blockhist: {
        '0': {
          blockqlist: ['101', '102'],
          answers: ['B', ''],
          highlights: ['[]', '[]'],
          notes: ['', ''],
          questionStates: [
            { submitted: true, revealed: true, correct: true, visited: true, eliminatedChoices: [] },
            { submitted: false, revealed: false, correct: false, visited: false, eliminatedChoices: [] }
          ],
          complete: false,
          timelimit: -1,
          elapsedtime: 120,
          numcorrect: 1,
          mode: 'tutor',
          qpoolstr: 'Unused',
          tagschosenstr: '',
          allsubtagsenabled: true,
          starttime: '1/1/2026, 12:00:00 PM',
          currentquesnum: 1,
          showans: true,
          reviewLayout: 'split'
        }
      },
      tagbuckets: {
        System: {
          Cardiology: {
            all: ['101', '102', '103'],
            unused: ['103'],
            incorrects: [],
            flagged: ['102']
          }
        },
        Topic: {
          Electrophysiology: {
            all: ['101', '102'],
            unused: [],
            incorrects: [],
            flagged: ['102']
          },
          Ischemia: {
            all: ['103'],
            unused: ['103'],
            incorrects: [],
            flagged: []
          }
        }
      }
    },
    path: '/api/study-packs/pack-1/file',
    revision: 3,
    blockToOpen: '0'
  }
}
