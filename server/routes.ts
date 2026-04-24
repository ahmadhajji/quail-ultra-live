export type AppRouteName = 'study-packs' | 'overview' | 'newblock' | 'previousblocks' | 'examview' | 'admin' | 'library'

export function routePathFor(pageName: AppRouteName): string {
  if (pageName === 'study-packs') {
    return '/'
  }
  return `/${pageName}`
}

export function legacyPageRedirectTarget(pageName: string): string {
  if (pageName === 'loadbank') {
    return '/'
  }
  return `/${pageName}`
}
