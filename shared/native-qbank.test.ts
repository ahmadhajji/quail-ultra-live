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

  it('rejects native manifest paths that are not strict pack-relative paths', async () => {
    const badPaths = [
      'questions/./q.json',
      'questions//q.json',
      'questions/',
      '/questions/q.json',
      'questions\\q.json',
      'questions/../q.json',
      'questions/%2e%2e/q.json',
      'C:questions/q.json',
      'https://example.test/q.json'
    ]

    for (const badPath of badPaths) {
      const workspaceRoot = await copyFixture('native-pack-minimal')
      const manifestPath = path.join(workspaceRoot, 'quail-ultra-pack.json')
      const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
      manifest.questionIndex[0].path = badPath
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

      const result = await validateNativeQbankDirectory(workspaceRoot)
      expect(result.ok, badPath).toBe(false)
      expect(result.errors.join('\n'), badPath).toMatch(/path|unsafe/i)
    }
  })

  it('rejects unsafe native media index and question media paths', async () => {
    const cases = [
      {
        label: 'mediaIndex',
        mutate(manifest: any, _question: any) {
          manifest.mediaIndex[0].path = 'media/%2e%2e/secret.svg'
        }
      },
      {
        label: 'question media',
        mutate(_manifest: any, question: any) {
          question.media[0].path = 'C:media/q01.svg'
        }
      }
    ]

    for (const testCase of cases) {
      const workspaceRoot = await copyFixture('native-pack-minimal')
      const manifestPath = path.join(workspaceRoot, 'quail-ultra-pack.json')
      const questionPath = path.join(workspaceRoot, 'questions', 'peds.sample.s001.q01.json')
      const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
      const question = JSON.parse(await fsp.readFile(questionPath, 'utf8'))
      testCase.mutate(manifest, question)
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
      await fsp.writeFile(questionPath, JSON.stringify(question, null, 2))

      const result = await validateNativeQbankDirectory(workspaceRoot)
      expect(result.ok, testCase.label).toBe(false)
      expect(result.errors.join('\n'), testCase.label).toMatch(/path|unsafe/i)
    }
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
      '3': 'Topic',
      '4': 'Source Material'
    })
    expect(qbankinfo.choices['peds.sample.s001.q01']).toEqual({
      options: ['A', 'B', 'C', 'D'],
      correct: 'B'
    })
    expect(qbankinfo.nativeContent.questionPaths['peds.sample.s001.q01']).toBe('questions/peds.sample.s001.q01.json')
    expect(qbankinfo.questionMeta['peds.sample.s001.q01'].source_slide.asset_path).toBe('source-slides/peds-sample/slide-001.svg')
    expect(qbankinfo.progress.tagbuckets.Rotation.Pediatrics.all).toHaveLength(3)
  })

  it('keeps deprecated native questions readable but excludes them from new block buckets', async () => {
    const workspaceRoot = await copyFixture('native-pack-minimal')
    const manifestPath = path.join(workspaceRoot, 'quail-ultra-pack.json')
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
    manifest.questionIndex[2].status = 'deprecated'
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    const questionPath = path.join(workspaceRoot, 'questions', 'peds.sample.s003.q01.json')
    const question = JSON.parse(await fsp.readFile(questionPath, 'utf8'))
    question.status = 'deprecated'
    await fsp.writeFile(questionPath, JSON.stringify(question, null, 2))

    const result = await validateNativeQbankDirectory(workspaceRoot)
    const qbankinfo = await loadWorkspaceData(workspaceRoot)

    expect(result.ok).toBe(true)
    expect(Object.keys(qbankinfo.index)).toEqual([
      'peds.sample.s001.q01',
      'peds.sample.s002.q01'
    ])
    expect(qbankinfo.choices['peds.sample.s003.q01'].correct).toBe('D')
    expect(qbankinfo.progress.tagbuckets.Rotation.Pediatrics.all).toHaveLength(2)
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
