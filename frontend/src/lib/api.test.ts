import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQbankInfoFixture } from '../test/fixtures'

interface FakeRequest<T> {
  result: T
  error: Error | null
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}

class FakeObjectStore {
  private store: Map<string, unknown>
  private keyPath: string
  private transactionRef: FakeTransaction

  constructor(store: Map<string, unknown>, keyPath: string, transactionRef: FakeTransaction) {
    this.store = store
    this.keyPath = keyPath
    this.transactionRef = transactionRef
  }

  get(key: string): FakeRequest<unknown> {
    return createRequest(this.store.get(key))
  }

  getAll(): FakeRequest<unknown[]> {
    return createRequest(Array.from(this.store.values()).map((value) => structuredClone(value)))
  }

  put(value: Record<string, unknown>): void {
    this.store.set(String(value[this.keyPath]), structuredClone(value))
    queueMicrotask(() => {
      this.transactionRef.oncomplete?.(new Event('complete'))
    })
  }

  delete(key: string): void {
    this.store.delete(key)
    queueMicrotask(() => {
      this.transactionRef.oncomplete?.(new Event('complete'))
    })
  }
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  error: Error | null = null
  private stores: Map<string, Map<string, unknown>>
  private keyPaths: Map<string, string>

  constructor(stores: Map<string, Map<string, unknown>>, keyPaths: Map<string, string>) {
    this.stores = stores
    this.keyPaths = keyPaths
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.stores.get(name)
    const keyPath = this.keyPaths.get(name)
    if (!store || !keyPath) {
      throw new Error(`Unknown object store: ${name}`)
    }
    return new FakeObjectStore(store, keyPath, this)
  }
}

class FakeDatabase {
  private stores = new Map<string, Map<string, unknown>>()
  private keyPaths = new Map<string, string>()

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name)
  }

  createObjectStore(name: string, options: { keyPath: string }): void {
    this.stores.set(name, new Map())
    this.keyPaths.set(name, options.keyPath)
  }

  transaction(_storeName: string, _mode: 'readonly' | 'readwrite'): FakeTransaction {
    return new FakeTransaction(this.stores, this.keyPaths)
  }
}

function createRequest<T>(result: T): FakeRequest<T> {
  const request: FakeRequest<T> = {
    result,
    error: null,
    onsuccess: null,
    onerror: null
  }
  queueMicrotask(() => {
    request.onsuccess?.(new Event('success'))
  })
  return request
}

function createFakeIndexedDb() {
  const database = new FakeDatabase()
  return {
    open: vi.fn((_name: string, _version: number) => {
      const request = {
        result: database,
        error: null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: Event) => void) | null
      }
      queueMicrotask(() => {
        request.onupgradeneeded?.(new Event('upgradeneeded'))
        queueMicrotask(() => {
          request.onsuccess?.(new Event('success'))
        })
      })
      return request
    })
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null)
    },
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

function hangingResponse(_url: string, options?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = options?.signal
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

describe('api offline resilience', () => {
  let online = false

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    window.localStorage.clear()
    document.body.innerHTML = ''

    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      writable: true,
      value: createFakeIndexedDb()
    })

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('falls back to the cached pack when qbank loading times out', async () => {
    const fixture = createQbankInfoFixture()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const api = await import('./api')
    const pack = {
      id: 'pack-1',
      name: 'Test Pack',
      questionCount: fixture.progress.blockhist['0']?.blockqlist.length ?? 0,
      revision: fixture.revision,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    fetchMock.mockResolvedValueOnce(jsonResponse({ qbankinfo: fixture, pack }))
    const seeded = await api.loadPack('pack-1', '0')
    await vi.runAllTimersAsync()
    expect(seeded.blockToOpen).toBe('0')

    fetchMock.mockImplementationOnce(hangingResponse)
    const reloadedPromise = api.loadPack('pack-1', '0')
    await vi.advanceTimersByTimeAsync(5000)
    const reloaded = await reloadedPromise

    expect(reloaded.progress.blockhist['0']?.blockqlist).toEqual(fixture.progress.blockhist['0']?.blockqlist)
    expect(document.getElementById('syncBanner')?.textContent).toContain('Offline mode')
  })

  it('queues timed-out progress sync locally and flushes it later', async () => {
    const fixture = createQbankInfoFixture()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const api = await import('./api')
    const pack = {
      id: 'pack-1',
      name: 'Test Pack',
      questionCount: fixture.progress.blockhist['0']?.blockqlist.length ?? 0,
      revision: fixture.revision,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    fetchMock.mockResolvedValueOnce(jsonResponse({ qbankinfo: fixture, pack }))
    await api.loadPack('pack-1', '0')
    await vi.runAllTimersAsync()

    online = true

    const nextProgress = structuredClone(fixture.progress)
    nextProgress.blockhist['0']!.complete = true
    nextProgress.blockhist['0']!.numcorrect = 2

    fetchMock.mockImplementationOnce(hangingResponse)
    const syncPromise = api.syncProgress('pack-1', nextProgress)
    await vi.advanceTimersByTimeAsync(5000)

    await expect(syncPromise).resolves.toEqual({ queued: true })
    expect(document.getElementById('syncBanner')?.textContent).toContain('Saved locally')

    fetchMock.mockResolvedValueOnce(jsonResponse({ revision: 4 }))
    await api.flushDirtyProgress()
    await vi.runAllTimersAsync()

    const lastCall = fetchMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('/api/study-packs/pack-1/progress')
    expect(lastCall?.[1]).toMatchObject({
      method: 'PUT',
      credentials: 'include'
    })
    expect(JSON.parse(String(lastCall?.[1]?.body))).toMatchObject({
      progress: nextProgress,
      baseRevision: fixture.revision
    })
  })
})
