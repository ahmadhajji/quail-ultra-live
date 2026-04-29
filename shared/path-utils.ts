import path from 'node:path'

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function validateStrictRelativePath(value: string): string {
  const raw = String(value || '')
  if (!raw || raw.startsWith('/') || raw.startsWith('\\') || raw.includes('\\') || CONTROL_CHARS.test(raw)) {
    throw new Error('Invalid relative path')
  }
  const parts = raw.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid relative path')
  }
  return parts.join('/')
}

export function safeResolveWithin(rootDir: string, relativePath: string): string {
  const cleanRelative = validateStrictRelativePath(relativePath)
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, cleanRelative)
  if (resolved !== root && resolved.startsWith(`${root}${path.sep}`)) {
    return resolved
  }
  throw new Error('Invalid relative path')
}
