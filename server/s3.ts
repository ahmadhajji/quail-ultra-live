// @ts-nocheck
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  getS3AccessKeyId,
  getS3Bucket,
  getS3Endpoint,
  getS3Region,
  getS3SecretAccessKey,
  shouldUseS3PathStyle
} from './config'
import { safeResolveWithin, validateStrictRelativePath } from '../shared/path-utils'

let client: S3Client | undefined

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.html') {
    return 'text/html; charset=utf-8'
  }
  if (extension === '.json') {
    return 'application/json; charset=utf-8'
  }
  if (extension === '.zip') {
    return 'application/zip'
  }
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  if (extension === '.gif') {
    return 'image/gif'
  }
  if (extension === '.svg') {
    return 'image/svg+xml'
  }
  return undefined
}

function getClient() {
  if (!client) {
    client = new S3Client({
      region: getS3Region(),
      endpoint: getS3Endpoint(),
      forcePathStyle: shouldUseS3PathStyle(),
      credentials: {
        accessKeyId: getS3AccessKeyId(),
        secretAccessKey: getS3SecretAccessKey()
      }
    })
  }
  return client
}

function getBucket() {
  return getS3Bucket()
}

async function collectFiles(directory: string, prefix: string): Promise<Array<{ absolutePath: string, key: string }>> {
  const files: Array<{ absolutePath: string, key: string }> = []
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    const key = prefix ? `${prefix}/${validateStrictRelativePath(entry.name)}` : validateStrictRelativePath(entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, key))
    } else if (entry.isFile()) {
      files.push({ absolutePath, key })
    }
  }
  return files
}

export async function listS3Keys(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined
  do {
    const response = await getClient().send(new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: `${prefix}/`,
      ContinuationToken: continuationToken
    }))
    for (const item of response.Contents || []) {
      if (item.Key) {
        keys.push(item.Key)
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
  } while (continuationToken)
  return keys
}

export async function readS3Text(key: string): Promise<string | null> {
  try {
    const response = await getClient().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key
    }))
    if (!response.Body) {
      return null
    }
    return await response.Body.transformToString()
  } catch (error: any) {
    const statusCode = error?.$metadata?.httpStatusCode
    const code = error?.name || error?.Code
    if (statusCode === 404 || code === 'NoSuchKey' || code === 'NotFound') {
      return null
    }
    throw error
  }
}

export async function readS3Json(key: string): Promise<any | null> {
  const text = await readS3Text(key)
  return text ? JSON.parse(text) : null
}

export async function writeS3Object(key: string, body: Buffer | string, contentType?: string): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ...(contentType ? { ContentType: contentType } : {})
  }))
}

export async function writeS3Json(key: string, value: any): Promise<void> {
  await writeS3Object(key, JSON.stringify(value, null, 2), 'application/json; charset=utf-8')
}

export async function getS3FileStream(key: string) {
  const response = await getClient().send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: key
  }))
  if (!response.Body) {
    throw new Error('File not found')
  }
  return {
    stream: Readable.fromWeb(response.Body.transformToWebStream()),
    contentType: response.ContentType || 'application/octet-stream'
  }
}

export async function headS3Object(key: string): Promise<{ exists: boolean, contentLength: number }> {
  try {
    const response = await getClient().send(new HeadObjectCommand({
      Bucket: getBucket(),
      Key: key
    }))
    return {
      exists: true,
      contentLength: Number(response.ContentLength || 0)
    }
  } catch (error: any) {
    const statusCode = error?.$metadata?.httpStatusCode
    const code = error?.name || error?.Code
    if (statusCode === 404 || code === 'NoSuchKey' || code === 'NotFound') {
      return { exists: false, contentLength: 0 }
    }
    throw error
  }
}

export async function materializeS3PrefixToTemp(prefix: string, limits?: { maxFiles?: number, maxBytes?: number, maxFileSize?: number }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'quail-ultra-live-import-'))
  const keys = await listS3Keys(prefix)
  if (limits?.maxFiles != null && keys.length > limits.maxFiles) {
    throw new Error('Import contains too many files')
  }
  let totalBytes = 0
  for (const key of keys) {
    const relativePath = validateStrictRelativePath(key.slice(`${prefix}/`.length))
    const targetPath = safeResolveWithin(tempRoot, relativePath)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    const head = await headS3Object(key)
    if (!head.exists) {
      throw new Error(`Unable to fetch staged object ${key}`)
    }
    if (limits?.maxFileSize != null && head.contentLength > limits.maxFileSize) {
      throw new Error('A staged import file exceeds the per-file upload limit')
    }
    totalBytes += head.contentLength
    if (limits?.maxBytes != null && totalBytes > limits.maxBytes) {
      throw new Error('Import exceeds the aggregate upload limit')
    }
    const response = await getClient().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key
    }))
    if (!response.Body) {
      throw new Error(`Unable to fetch staged object ${key}`)
    }
    await pipeline(Readable.fromWeb(response.Body.transformToWebStream()), createWriteStream(targetPath))
  }
  return tempRoot
}

export async function deleteS3Prefix(prefix: string) {
  const keys = await listS3Keys(prefix)
  if (keys.length === 0) {
    return
  }
  for (let index = 0; index < keys.length; index += 1000) {
    const slice = keys.slice(index, index + 1000)
    await getClient().send(new DeleteObjectsCommand({
      Bucket: getBucket(),
      Delete: {
        Objects: slice.map((key) => ({ Key: key }))
      }
    }))
  }
}

async function uploadS3File(key: string, absolutePath: string) {
  const body = await fs.readFile(absolutePath)
  const contentType = getContentType(absolutePath)
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await writeS3Object(key, body, contentType)
      return
    } catch (error) {
      lastError = error
      if (attempt === 4) {
        break
      }
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Retrying S3 upload for ${key} (attempt ${attempt}/4 failed: ${message})`)
      await sleep(message.includes('SlowDown') ? attempt * 5000 : attempt * 1000)
    }
  }
  throw lastError
}

export async function uploadDirectoryToS3(prefix: string, directory: string) {
  const existing = new Set(await listS3Keys(prefix))
  const files = (await collectFiles(directory, prefix)).filter((file) => !existing.has(file.key))
  let uploaded = 0
  let nextIndex = 0
  const concurrency = 4

  async function worker() {
    while (nextIndex < files.length) {
      const current = files[nextIndex]
      nextIndex += 1
      if (!current) {
        return
      }
      await uploadS3File(current.key, current.absolutePath)
      uploaded += 1
      if (uploaded % 100 === 0 || uploaded === files.length) {
        console.log(`Uploaded ${uploaded}/${files.length} files under ${prefix}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, () => worker()))
}

export async function copyS3Prefix(sourcePrefix: string, destinationPrefix: string) {
  const keys = await listS3Keys(sourcePrefix)
  for (const key of keys) {
    const relativePath = key.slice(`${sourcePrefix}/`.length)
    await getClient().send(new CopyObjectCommand({
      Bucket: getBucket(),
      CopySource: `${getBucket()}/${key}`,
      Key: `${destinationPrefix}/${relativePath}`
    }))
  }
}

export async function createPresignedUpload(relativePath: string, contentType?: string) {
  const key = validateStrictRelativePath(relativePath)
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ...(contentType ? { ContentType: contentType } : {})
  })
  const url = await getSignedUrl(getClient(), command, { expiresIn: 15 * 60 })
  return {
    key,
    url,
    headers: contentType ? { 'content-type': contentType } : {}
  }
}

export async function checkS3Readiness(): Promise<void> {
  const key = `health/readiness-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  await writeS3Object(key, 'ok', 'text/plain; charset=utf-8')
  await getClient().send(new HeadObjectCommand({
    Bucket: getBucket(),
    Key: key
  }))
  await getClient().send(new DeleteObjectsCommand({
    Bucket: getBucket(),
    Delete: {
      Objects: [{ Key: key }]
    }
  }))
}
