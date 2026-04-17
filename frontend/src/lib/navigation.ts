export type PageParams = Record<string, string | undefined>

export type PageName = 'index' | 'overview' | 'newblock' | 'previousblocks' | 'examview' | 'admin'

type NavigateOptions = {
  replace?: boolean
}

type NavigateImpl = (to: string, options?: NavigateOptions) => void

let navigateImpl: NavigateImpl | null = null

export function getCurrentPackId(): string {
  return new URLSearchParams(window.location.search).get('pack') ?? ''
}

export function getCurrentBlockKey(): string {
  return new URLSearchParams(window.location.search).get('block') ?? ''
}

export function buildPageUrl(pageName: PageName, params: PageParams = {}): string {
  const pathname = pageName === 'index' ? '/' : `/${pageName}`
  const url = new URL(pathname, window.location.origin)
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value !== '') {
      url.searchParams.set(key, value)
    }
  }
  return `${url.pathname}${url.search}`
}

export function registerNavigateHandler(handler: NavigateImpl | null): void {
  navigateImpl = handler
}

export function navigate(pageName: PageName, params: PageParams = {}, options?: NavigateOptions): void {
  const nextUrl = buildPageUrl(pageName, params)
  if (navigateImpl) {
    navigateImpl(nextUrl, options)
    return
  }
  if (options?.replace) {
    window.location.replace(nextUrl)
    return
  }
  window.location.href = nextUrl
}
