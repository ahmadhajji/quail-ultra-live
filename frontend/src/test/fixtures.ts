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
    progress: {
      blockhist: {
        '0': {
          blockqlist: ['101', '102'],
          answers: ['B', ''],
          highlights: ['[]', '[]'],
          questionStates: [
            { submitted: true, revealed: true, correct: true, eliminatedChoices: [] },
            { submitted: false, revealed: false, correct: false, eliminatedChoices: [] }
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
