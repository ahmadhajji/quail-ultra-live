import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const { findWorkspaceRoot, loadWorkspaceData } = require('./qbank.ts')
const { validateNativeQbankDirectory } = require('./native-qbank.ts')

const fixtureRoot = path.resolve(__dirname, '..', 'contracts', 'quail-ultra-qbank', 'v1', 'fixtures')
const tempRoots: string[] = []

async function copyFixture(name: string) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-native-fixture-'))
  tempRoots.push(tempRoot)
  const target = path.join(tempRoot, name)
  await fsp.cp(path.join(fixtureRoot, name), target, { recursive: true })
  return target
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) {
      await fsp.rm(root, { recursive: true, force: true })
    }
  }
})

describe('native qbank contract validation', () => {
  it('accepts the minimal native fixture', async () => {
    const workspaceRoot = await copyFixture('native-pack-minimal')
    const result = await validateNativeQbankDirectory(workspaceRoot)

    expect(result.ok).toBe(true)
    expect(result.questionCount).toBe(3)
    expect(result.errors).toEqual([])
  })

  it('rejects malformed native packs with specific errors', async () => {
    const workspaceRoot = await copyFixture('native-pack-invalid')
    const result = await validateNativeQbankDirectory(workspaceRoot)

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('answerKey')
    expect(result.errors.join('\n')).toContain('validation.status is failed')
  })

  it('normalizes a native pack into the existing qbankinfo shape', async () => {
    const workspaceRoot = await copyFixture('native-pack-minimal')
    const qbankinfo = await loadWorkspaceData(workspaceRoot)

    expect(qbankinfo.format).toBe('native')
    expect(qbankinfo.nativeContent.format).toBe('quail-ultra-qbank')
    expect(Object.keys(qbankinfo.index)).toEqual([
      'peds.sample.s001.q01',
      'peds.sample.s002.q01',
      'peds.sample.s003.q01'
    ])
    expect(qbankinfo.tagnames.tagnames).toEqual({
      '0': 'Rotation',
      '1': 'Subject',
      '2': 'System',
      '3': 'Topic'
    })
    expect(qbankinfo.choices['peds.sample.s001.q01']).toEqual({
      options: ['A', 'B', 'C', 'D'],
      correct: 'B'
    })
    expect(qbankinfo.questionMeta['peds.sample.s001.q01'].source_slide.asset_path).toBe('source-slides/peds-sample/slide-001.svg')
    expect(qbankinfo.progress.tagbuckets.Rotation.Pediatrics.all).toHaveLength(3)
  })

  it('keeps legacy fixture detection intact', async () => {
    const workspaceRoot = await copyFixture('legacy-pack-minimal')
    const detected = await findWorkspaceRoot(workspaceRoot)
    const qbankinfo = await loadWorkspaceData(detected)

    expect(detected).toBe(workspaceRoot)
    expect(qbankinfo.format).toBeUndefined()
    expect(qbankinfo.choices['001'].correct).toBe('B')
  })
})
