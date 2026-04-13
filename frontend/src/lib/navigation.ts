export type PageParams = Record<string, string | undefined>

export type PageName = 'index' | 'overview' | 'newblock' | 'previousblocks' | 'examview' | 'admin'

export function getCurrentPackId(): string {
  return new URLSearchParams(window.location.search).get('pack') ?? ''
}

export function getCurrentBlockKey(): string {
  return new URLSearchParams(window.location.search).get('block') ?? ''
}

export function buildPageUrl(pageName: PageName, params: PageParams = {}): string {
  const url = new URL(pageName === 'index' ? '/' : `/${pageName}.html`, window.location.origin)
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value !== '') {
      url.searchParams.set(key, value)
    }
  }
  return `${url.pathname}${url.search}`
}

export function navigate(pageName: PageName, params: PageParams = {}): void {
  window.location.href = buildPageUrl(pageName, params)
}
