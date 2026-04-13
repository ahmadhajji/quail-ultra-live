import type { DirtyProgressEntry, SyncProgressOptions, SyncProgressResult } from '../types/domain'

interface Resolver {
  resolve: (result: SyncProgressResult) => void
  reject: (error: unknown) => void
}

interface PackQueueState {
  inFlight: boolean
  latestEntry: DirtyProgressEntry | null
  timerId: number | null
  resolvers: Resolver[]
}

type SendProgressEntry = (entry: DirtyProgressEntry, options: SyncProgressOptions) => Promise<SyncProgressResult>

const DEFAULT_DEBOUNCE_MS = 700

function compactSyncOptions(options: SyncProgressOptions): SyncProgressOptions {
  return {
    ...(options.immediate !== undefined ? { immediate: options.immediate } : {}),
    ...(options.keepalive !== undefined ? { keepalive: options.keepalive } : {}),
    ...(options.silent !== undefined ? { silent: options.silent } : {})
  }
}

export class ProgressSyncCoordinator {
  private readonly sendEntry: SendProgressEntry

  private readonly queueStates = new Map<string, PackQueueState>()

  constructor(sendEntry: SendProgressEntry) {
    this.sendEntry = sendEntry
  }

  queue(entry: DirtyProgressEntry, options: SyncProgressOptions = {}): Promise<SyncProgressResult> {
    const state = this.getState(entry.packId)
    state.latestEntry = entry

    const promise = new Promise<SyncProgressResult>((resolve, reject) => {
      state.resolvers.push({ resolve, reject })
    })

    if (options.immediate) {
      this.clearTimer(state)
      void this.flushPack(entry.packId, options)
      return promise
    }

    this.clearTimer(state)
    state.timerId = window.setTimeout(() => {
      state.timerId = null
      void this.flushPack(entry.packId, options)
    }, DEFAULT_DEBOUNCE_MS)

    return promise
  }

  async flushPack(packId: string, options: SyncProgressOptions = {}): Promise<SyncProgressResult | null> {
    const state = this.getState(packId)
    this.clearTimer(state)

    if (state.inFlight || !state.latestEntry) {
      return null
    }

    const entry = state.latestEntry
    const resolvers = state.resolvers.splice(0)
    state.latestEntry = null
    state.inFlight = true

    try {
      const result = await this.sendEntry(entry, {
        ...compactSyncOptions(options),
        immediate: true
      })
      resolvers.forEach((resolver) => resolver.resolve(result))
      return result
    } catch (error) {
      resolvers.forEach((resolver) => resolver.reject(error))
      throw error
    } finally {
      state.inFlight = false
      if (state.latestEntry) {
        void this.flushPack(packId, {
          ...compactSyncOptions(options),
          immediate: true
        })
      }
    }
  }

  async flushAll(options: SyncProgressOptions = {}): Promise<void> {
    const packIds = Array.from(this.queueStates.keys())
    for (const packId of packIds) {
      await this.flushPack(packId, options)
    }
  }

  private getState(packId: string): PackQueueState {
    let state = this.queueStates.get(packId)
    if (!state) {
      state = {
        inFlight: false,
        latestEntry: null,
        timerId: null,
        resolvers: []
      }
      this.queueStates.set(packId, state)
    }
    return state
  }

  private clearTimer(state: PackQueueState): void {
    if (state.timerId !== null) {
      window.clearTimeout(state.timerId)
      state.timerId = null
    }
  }
}
