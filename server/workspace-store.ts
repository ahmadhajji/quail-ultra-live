// @ts-nocheck
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { copy, del, get, list, put } from '@vercel/blob'
import { normalizeProgress } from '../shared/progress'
import { findWorkspaceRoot, listWorkspaceManifest, loadWorkspaceData, safeResolveWorkspaceFile, saveProgress, withPackPath } from '../shared/qbank'
import { PACKS_DIR, getBlobToken, getStorageBackend } from './config'
import {
  deleteS3Prefix,
  getS3FileStream,
  listS3Keys,
  materializeS3PrefixToTemp,
  readS3Json,
  uploadDirectoryToS3,
  writeS3Json
} from './s3'

type LoadedPack = {
  qbankinfo: any
}

type PackFileResult =
  | { kind: 'path', absolutePath: string }
  | { kind: 'stream', stream: Readable, contentType: string }

async function ensureDir(target: string) {
  await fsp.mkdir(target, { recursive: true })
}

async function readStreamToBuffer(stream: ReadableStream<Uint8Array>) {
  const chunks: Buffer[] = []
  const nodeStream = Readable.fromWeb(stream)
  for await (const chunk of nodeStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getUploadContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase()
  return extension === '.html'
    ? 'text/html; charset=utf-8'
    : extension === '.json'
      ? 'application/json; charset=utf-8'
      : extension === '.zip'
        ? 'application/zip'
        : undefined
}

async function uploadBlobFile(pathname: string, absolutePath: string) {
  const body = await fsp.readFile(absolutePath)
  const contentType = getUploadContentType(absolutePath)
  const timeoutMs = body.byteLength >= 1024 * 1024 ? 180_000 : 90_000
  let lastError: unknown

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await put(pathname, body, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        multipart: body.byteLength >= 1024 * 1024,
        ...(contentType ? { contentType } : {}),
        abortSignal: controller.signal,
        token: getBlobToken()
      })
      clearTimeout(timeout)
      return
    } catch (error) {
      clearTimeout(timeout)
      lastError = error
      if (attempt === 4) {
        break
      }
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Retrying blob upload for ${pathname} (attempt ${attempt}/4 failed: ${message})`)
      await sleep(message.includes('Rate exceeded') ? attempt * 5000 : attempt * 1000)
    }
  }

  throw lastError
}

async function listBlobPathnames(prefix: string) {
  const pathnames = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await list({
      prefix: `${prefix}/`,
      cursor,
      limit: 1000,
      token: getBlobToken()
    })
    for (const blob of page.blobs) {
      pathnames.add(blob.pathname)
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return pathnames
}

async function collectFiles(directory: string, prefix: string): Promise<Array<{ absolutePath: string, relativePath: string }>> {
  const files: Array<{ absolutePath: string, relativePath: string }> = []
  const entries = await fsp.readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath))
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath })
    }
  }

  return files
}

async function uploadDirectoryToBlob(prefix: string, directory: string) {
  const existing = await listBlobPathnames(prefix)
  const files = (await collectFiles(directory, prefix))
    .filter((file) => !existing.has(file.relativePath))

  let uploadedFiles = 0
  let nextIndex = 0
  const concurrency = 4

  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex
      nextIndex += 1
      const file = files[index]
      await uploadBlobFile(file.relativePath, file.absolutePath)
      uploadedFiles += 1
      if (uploadedFiles % 100 === 0 || uploadedFiles === files.length) {
        console.log(`Uploaded ${uploadedFiles}/${files.length} files under ${prefix}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, () => worker()))
}

async function removeBlobPrefix(prefix: string) {
  let cursor: string | undefined
  do {
    const page = await list({
      prefix: `${prefix}/`,
      cursor,
      limit: 1000,
      token: getBlobToken()
    })
    if (page.blobs.length > 0) {
      await del(page.blobs.map((blob) => blob.pathname), { token: getBlobToken() })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
}

abstract class BaseWorkspaceStore {
  abstract backend: 'local' | 'cloud'
  abstract loadPack(packRow: any, blockToOpen: string): Promise<LoadedPack>
  abstract savePackProgress(workspacePath: string, progress: any): Promise<void>
  abstract listManifest(workspacePath: string): Promise<string[]>
  abstract getPackFile(workspacePath: string, relativePath: string): Promise<PackFileResult>
  abstract deleteWorkspace(workspacePath: string): Promise<void>
  abstract finalizeImportedWorkspace(sessionRow: any, packId: string): Promise<{ workspacePath: string, questionCount: number, packName: string }>
  abstract importWorkspaceFromLocalDirectory(directory: string, targetPrefixOrPath: string): Promise<{ questionCount: number, packName: string }>
  abstract cancelImportWorkspace(sessionRow: any): Promise<void>
}

class LocalWorkspaceStore extends BaseWorkspaceStore {
  backend = 'local' as const

  async loadPack(packRow: any, blockToOpen: string) {
    const qbankinfo = await loadWorkspaceData(packRow.workspace_path)
    return { qbankinfo: withPackPath(qbankinfo, packRow.id, packRow.revision, blockToOpen) }
  }

  async savePackProgress(workspacePath: string, progress: any) {
    await saveProgress(workspacePath, progress)
  }

  async listManifest(workspacePath: string) {
    return listWorkspaceManifest(workspacePath)
  }

  async getPackFile(workspacePath: string, relativePath: string) {
    const absolutePath = safeResolveWorkspaceFile(workspacePath, relativePath)
    return { kind: 'path', absolutePath }
  }

  async deleteWorkspace(workspacePath: string) {
    await fsp.rm(path.dirname(workspacePath), { recursive: true, force: true })
  }

  async finalizeImportedWorkspace(sessionRow: any, packId: string) {
    const workspaceRoot = await findWorkspaceRoot(sessionRow.upload_root)
    const prepared = await loadWorkspaceData(workspaceRoot)
    const finalRoot = path.join(PACKS_DIR, packId)
    const finalWorkspace = path.join(finalRoot, 'workspace')
    await ensureDir(finalRoot)
    await fsp.cp(workspaceRoot, finalWorkspace, { recursive: true })
    return {
      workspacePath: finalWorkspace,
      questionCount: Object.keys(prepared.index).length,
      packName: path.basename(workspaceRoot)
    }
  }

  async importWorkspaceFromLocalDirectory(directory: string, targetPath: string) {
    const workspaceRoot = await findWorkspaceRoot(directory)
    const prepared = await loadWorkspaceData(workspaceRoot)
    await ensureDir(path.dirname(targetPath))
    await fsp.cp(workspaceRoot, targetPath, { recursive: true })
    return {
      questionCount: Object.keys(prepared.index).length,
      packName: path.basename(workspaceRoot)
    }
  }

  async cancelImportWorkspace(sessionRow: any) {
    if (sessionRow.temp_root) {
      await fsp.rm(sessionRow.temp_root, { recursive: true, force: true })
    }
  }
}

class BlobWorkspaceStore extends BaseWorkspaceStore {
  backend = 'cloud' as const

  async readBlobText(pathname: string) {
    const result = await get(pathname, { access: 'private', token: getBlobToken(), useCache: false })
    if (!result || result.statusCode !== 200) {
      return null
    }
    const buffer = await readStreamToBuffer(result.stream)
    return buffer.toString('utf8')
  }

  async readBlobJson(pathname: string) {
    const text = await this.readBlobText(pathname)
    return text ? JSON.parse(text) : null
  }

  async writeBlobJson(pathname: string, value: any) {
    await put(pathname, JSON.stringify(value, null, 2), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
      token: getBlobToken()
    })
  }

  async loadPack(packRow: any, blockToOpen: string) {
    const workspacePath = packRow.workspace_path
    const index = await this.readBlobJson(`${workspacePath}/index.json`)
    const tagnames = await this.readBlobJson(`${workspacePath}/tagnames.json`)
    const choices = await this.readBlobJson(`${workspacePath}/choices.json`)
    const groups = await this.readBlobJson(`${workspacePath}/groups.json`)
    const panes = await this.readBlobJson(`${workspacePath}/panes.json`)
    const questionMeta = await this.readBlobJson(`${workspacePath}/question-meta.json`)
    const progress = await this.readBlobJson(`${workspacePath}/progress.json`)
    if (!index || !tagnames || !choices || !groups || !panes || !progress) {
      throw new Error('Study Pack is missing required qbank metadata in blob storage.')
    }
    const qbankinfo = {
      index,
      tagnames,
      choices,
      groups,
      panes,
      ...(questionMeta ? { questionMeta } : {}),
      progress,
      path: `/api/study-packs/${packRow.id}/file`,
      revision: packRow.revision,
      blockToOpen: blockToOpen || ''
    }
    normalizeProgress(qbankinfo.progress, qbankinfo)
    return { qbankinfo }
  }

  async savePackProgress(workspacePath: string, progress: any) {
    await this.writeBlobJson(`${workspacePath}/progress.json`, progress)
  }

  async listManifest(workspacePath: string) {
    const results: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({
        prefix: `${workspacePath}/`,
        cursor,
        limit: 1000,
        token: getBlobToken()
      })
      for (const blob of page.blobs) {
        results.push(blob.pathname.slice(`${workspacePath}/`.length))
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    results.sort()
    return results
  }

  async getPackFile(workspacePath: string, relativePath: string) {
    const cleanRelative = relativePath.split('/').filter(Boolean).join('/')
    const blob = await get(`${workspacePath}/${cleanRelative}`, {
      access: 'private',
      token: getBlobToken()
    })
    if (!blob || blob.statusCode !== 200) {
      throw new Error('File not found')
    }
    return {
      kind: 'stream',
      stream: Readable.fromWeb(blob.stream),
      contentType: blob.blob.contentType || 'application/octet-stream'
    }
  }

  async deleteWorkspace(workspacePath: string) {
    await removeBlobPrefix(workspacePath)
  }

  async materializeImportPrefixToTemp(stagingPrefix: string) {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-ultra-live-import-'))
    let cursor: string | undefined
    do {
      const page = await list({
        prefix: `${stagingPrefix}/`,
        cursor,
        limit: 1000,
        token: getBlobToken()
      })
      for (const blob of page.blobs) {
        const relativePath = blob.pathname.slice(`${stagingPrefix}/`.length)
        const targetPath = path.join(tempRoot, relativePath)
        await ensureDir(path.dirname(targetPath))
        const result = await get(blob.pathname, { access: 'private', token: getBlobToken(), useCache: false })
        if (!result || result.statusCode !== 200) {
          throw new Error(`Unable to fetch staged blob ${blob.pathname}`)
        }
        const buffer = await readStreamToBuffer(result.stream)
        await fsp.writeFile(targetPath, buffer)
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return tempRoot
  }

  async finalizeImportedWorkspace(sessionRow: any, packId: string) {
    const tempRoot = await this.materializeImportPrefixToTemp(sessionRow.staging_prefix)
    try {
      const workspaceRoot = await findWorkspaceRoot(tempRoot)
      const prepared = await loadWorkspaceData(workspaceRoot)
      const finalPrefix = `packs/${packId}/workspace`
      await uploadDirectoryToBlob(finalPrefix, workspaceRoot)
      return {
        workspacePath: finalPrefix,
        questionCount: Object.keys(prepared.index).length,
        packName: path.basename(workspaceRoot)
      }
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true })
      await removeBlobPrefix(sessionRow.staging_prefix)
    }
  }

  async importWorkspaceFromLocalDirectory(directory: string, targetPrefix: string) {
    const workspaceRoot = await findWorkspaceRoot(directory)
    const prepared = await loadWorkspaceData(workspaceRoot)
    await uploadDirectoryToBlob(targetPrefix, workspaceRoot)
    return {
      questionCount: Object.keys(prepared.index).length,
      packName: path.basename(workspaceRoot)
    }
  }

  async cancelImportWorkspace(sessionRow: any) {
    if (sessionRow.staging_prefix) {
      await removeBlobPrefix(sessionRow.staging_prefix)
    }
  }
}

class RailwayWorkspaceStore extends BaseWorkspaceStore {
  backend = 'railway' as const

  async loadPack(packRow: any, blockToOpen: string) {
    const workspacePath = packRow.workspace_path
    const index = await readS3Json(`${workspacePath}/index.json`)
    const tagnames = await readS3Json(`${workspacePath}/tagnames.json`)
    const choices = await readS3Json(`${workspacePath}/choices.json`)
    const groups = await readS3Json(`${workspacePath}/groups.json`)
    const panes = await readS3Json(`${workspacePath}/panes.json`)
    const questionMeta = await readS3Json(`${workspacePath}/question-meta.json`)
    const progress = await readS3Json(`${workspacePath}/progress.json`)
    if (!index || !tagnames || !choices || !groups || !panes || !progress) {
      throw new Error('Study Pack is missing required qbank metadata in Railway bucket storage.')
    }
    const qbankinfo = {
      index,
      tagnames,
      choices,
      groups,
      panes,
      ...(questionMeta ? { questionMeta } : {}),
      progress,
      path: `/api/study-packs/${packRow.id}/file`,
      revision: packRow.revision,
      blockToOpen: blockToOpen || ''
    }
    normalizeProgress(qbankinfo.progress, qbankinfo)
    return { qbankinfo }
  }

  async savePackProgress(workspacePath: string, progress: any) {
    await writeS3Json(`${workspacePath}/progress.json`, progress)
  }

  async listManifest(workspacePath: string) {
    const keys = await listS3Keys(workspacePath)
    return keys
      .map((key) => key.slice(`${workspacePath}/`.length))
      .sort()
  }

  async getPackFile(workspacePath: string, relativePath: string) {
    const cleanRelative = relativePath.split('/').filter(Boolean).join('/')
    const file = await getS3FileStream(`${workspacePath}/${cleanRelative}`)
    return {
      kind: 'stream',
      stream: file.stream,
      contentType: file.contentType
    }
  }

  async deleteWorkspace(workspacePath: string) {
    await deleteS3Prefix(workspacePath)
  }

  async finalizeImportedWorkspace(sessionRow: any, packId: string) {
    const tempRoot = await materializeS3PrefixToTemp(sessionRow.staging_prefix)
    try {
      const workspaceRoot = await findWorkspaceRoot(tempRoot)
      const prepared = await loadWorkspaceData(workspaceRoot)
      const finalPrefix = `packs/${packId}/workspace`
      await uploadDirectoryToS3(finalPrefix, workspaceRoot)
      return {
        workspacePath: finalPrefix,
        questionCount: Object.keys(prepared.index).length,
        packName: path.basename(workspaceRoot)
      }
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true })
      await deleteS3Prefix(sessionRow.staging_prefix)
    }
  }

  async importWorkspaceFromLocalDirectory(directory: string, targetPrefix: string) {
    const workspaceRoot = await findWorkspaceRoot(directory)
    const prepared = await loadWorkspaceData(workspaceRoot)
    await uploadDirectoryToS3(targetPrefix, workspaceRoot)
    return {
      questionCount: Object.keys(prepared.index).length,
      packName: path.basename(workspaceRoot)
    }
  }

  async cancelImportWorkspace(sessionRow: any) {
    if (sessionRow.staging_prefix) {
      await deleteS3Prefix(sessionRow.staging_prefix)
    }
  }
}

export type WorkspaceStore = BaseWorkspaceStore

export function createWorkspaceStore(): WorkspaceStore {
  if (getStorageBackend() === 'cloud') {
    return new BlobWorkspaceStore()
  }
  if (getStorageBackend() === 'railway') {
    return new RailwayWorkspaceStore()
  }
  return new LocalWorkspaceStore()
}

export async function copyBlobPrefix(sourcePrefix: string, destinationPrefix: string) {
  let cursor: string | undefined
  do {
    const page = await list({
      prefix: `${sourcePrefix}/`,
      cursor,
      limit: 1000,
      token: getBlobToken()
    })
    for (const blob of page.blobs) {
      const relativePath = blob.pathname.slice(`${sourcePrefix}/`.length)
      await copy(blob.pathname, `${destinationPrefix}/${relativePath}`, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        token: getBlobToken()
      })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
}
