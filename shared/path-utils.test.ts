import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { safeResolveWithin, validateStrictRelativePath } from './path-utils'

describe('path utils', () => {
  it('accepts plain nested relative paths', () => {
    expect(validateStrictRelativePath('questions/q01.json')).toBe('questions/q01.json')
  })

  it('rejects traversal and ambiguous separators', () => {
    for (const candidate of ['', '.', '..', './q01.json', 'questions/../q01.json', '/tmp/q01.json', 'questions\\q01.json', 'questions//q01.json', 'q01\u0000.json']) {
      expect(() => validateStrictRelativePath(candidate)).toThrow(/Invalid relative path/)
    }
  })

  it('resolves inside the requested root with separator-aware containment', () => {
    const root = path.join(os.tmpdir(), 'quail-root')
    expect(safeResolveWithin(root, 'nested/file.txt')).toBe(path.join(root, 'nested/file.txt'))
    expect(() => safeResolveWithin(`${root}-prefix`, '../quail-root/file.txt')).toThrow(/Invalid relative path/)
  })
})
