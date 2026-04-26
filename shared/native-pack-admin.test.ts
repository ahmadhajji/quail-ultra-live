import { describe, expect, it } from 'vitest'
import { diffNativePackManifests } from './native-pack-admin'

function manifest(entries: any[]) {
  return {
    packId: 'pediatrics',
    revision: { number: 1, hash: 'r1' },
    questionIndex: entries
  }
}

function entry(id: string, contentHash: string, status = 'ready', correctChoiceId = 'A') {
  return {
    id,
    path: `questions/${id}.json`,
    status,
    titlePreview: id,
    tags: { rotation: 'Pediatrics', topic: 'Fixture' },
    contentHash,
    answerSummary: {
      correctChoiceId,
      choices: [
        { id: 'A', label: 'A', displayOrder: 1 },
        { id: 'B', label: 'B', displayOrder: 2 }
      ]
    }
  }
}

describe('native pack admin diff', () => {
  it('reports added, changed, unchanged, and deprecated questions', () => {
    const current = manifest([
      entry('peds.s001.q01', 'hash-1'),
      entry('peds.s002.q01', 'hash-2'),
      entry('peds.s003.q01', 'hash-3')
    ])
    const incoming = {
      ...manifest([
        entry('peds.s001.q01', 'hash-1'),
        entry('peds.s002.q01', 'hash-2-changed'),
        entry('peds.s003.q01', 'hash-3', 'deprecated'),
        entry('peds.s004.q01', 'hash-4')
      ]),
      revision: { number: 2, hash: 'r2', previousHash: 'r1' }
    }

    const diff = diffNativePackManifests(current, incoming, 'pediatrics')

    expect(diff.canPublish).toBe(true)
    expect(diff.unchanged.map((row) => row.id)).toEqual(['peds.s001.q01'])
    expect(diff.changed.map((row) => row.id)).toEqual(['peds.s002.q01', 'peds.s003.q01'])
    expect(diff.deprecated.map((row) => row.id)).toEqual(['peds.s003.q01'])
    expect(diff.added.map((row) => row.id)).toEqual(['peds.s004.q01'])
  })

  it('rejects hard deletes and blocked questions', () => {
    const current = manifest([
      entry('peds.s001.q01', 'hash-1'),
      entry('peds.s002.q01', 'hash-2')
    ])
    const incoming = {
      ...manifest([
        entry('peds.s001.q01', 'hash-1'),
        entry('peds.s003.q01', 'hash-3', 'blocked')
      ]),
      revision: { number: 2, hash: 'r2', previousHash: 'r1' }
    }

    const diff = diffNativePackManifests(current, incoming, 'pediatrics')

    expect(diff.canPublish).toBe(false)
    expect(diff.errors.join('\n')).toContain('peds.s002.q01')
    expect(diff.errors.join('\n')).toContain('blocked')
  })
})
