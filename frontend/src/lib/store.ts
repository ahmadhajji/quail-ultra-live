const STORE_PREFIX = 'quail-live:store:'
const WARM_PREFIX = 'quail-live:warm:'

function makeKey(key: string, namespace = ''): string {
  const prefix = namespace ? `${namespace}:` : ''
  return `${STORE_PREFIX}${prefix}${key}`
}

export const localStore = {
  get<T>(key: string, namespace = ''): T | undefined {
    const raw = window.localStorage.getItem(makeKey(key, namespace))
    if (raw === null) {
      return undefined
    }
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as T
    }
  },
  getString(key: string, namespace = ''): string | undefined {
    const value = this.get<unknown>(key, namespace)
    return typeof value === 'string' ? value : undefined
  },
  getJson<T>(key: string, namespace = ''): T | undefined {
    return this.get<T>(key, namespace)
  },
  has(key: string, namespace = ''): boolean {
    return window.localStorage.getItem(makeKey(key, namespace)) !== null
  },
  set(key: string, value: unknown, namespace = ''): void {
    window.localStorage.setItem(makeKey(key, namespace), JSON.stringify(value))
  },
  remove(key: string, namespace = ''): void {
    window.localStorage.removeItem(makeKey(key, namespace))
  }
}

export { STORE_PREFIX, WARM_PREFIX }
