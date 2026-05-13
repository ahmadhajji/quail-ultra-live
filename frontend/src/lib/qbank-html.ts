function createDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's',
  'small', 'source', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
  'audio', 'video'
])

const GLOBAL_ATTRIBUTES = new Set(['title', 'aria-label'])
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'style', 'data-openable-image']),
  audio: new Set(['src', 'controls', 'title']),
  video: new Set(['src', 'controls', 'poster', 'title']),
  source: new Set(['src', 'type']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope'])
}

function appendRelativeToBasePath(basePath: string, relativePath: string): string {
  const [pathPart, queryPart] = basePath.split('?')
  return `${pathPart}/${relativePath}${queryPart ? `?${queryPart}` : ''}`
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isStrictPackRelativePath(value: string): boolean {
  const raw = value.split('?')[0].split('#')[0]
  if (!raw || raw.startsWith('/') || raw.startsWith('\\') || raw.includes('\\') || CONTROL_CHARS.test(raw)) {
    return false
  }
  if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return false
  }
  return !raw.split('/').some((part) => !part || part === '.' || part === '..')
}

function isSafeUrl(value: string, tagName: string, attributeName: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (attributeName === 'href' && /^(https?:|mailto:)/i.test(trimmed)) {
    return true
  }
  if (/^\/api\/study-packs\/[^/]+\/file\//.test(trimmed)) {
    return true
  }
  if (tagName === 'img' && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return true
  }
  return isStrictPackRelativePath(trimmed)
}

function isAllowedImageStyle(value: string): boolean {
  return /^max-width:\s*100%;\s*max-height:\s*\d+px;?$/i.test(value.trim())
}

export function sanitizeLegacyHtml(html: string): string {
  const document = createDocument(html)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  const elements: Element[] = []
  while (walker.nextNode()) {
    elements.push(walker.currentNode as Element)
  }

  for (const element of elements) {
    const tagName = element.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tagName)) {
      element.replaceWith(document.createTextNode(element.textContent ?? ''))
      continue
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value
      const allowed = GLOBAL_ATTRIBUTES.has(name) || TAG_ATTRIBUTES[tagName]?.has(name)
      if (!allowed || name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if ((name === 'href' || name === 'src' || name === 'poster') && !isSafeUrl(value, tagName, name)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'style' && (tagName !== 'img' || !isAllowedImageStyle(value))) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'target' && value !== '_blank') {
        element.removeAttribute(attribute.name)
      }
    }

    if (tagName === 'a' && element.getAttribute('target') === '_blank') {
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }

  return document.body.innerHTML
}

function resolveAssetPath(basePath: string, rawPath: string | null): string | null {
  if (!rawPath) {
    return null
  }
  const trimmed = rawPath.trim()
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return rawPath
  }
  if (!isStrictPackRelativePath(trimmed)) {
    return null
  }
  return appendRelativeToBasePath(basePath, trimmed)
}

function isChoiceLine(text: string): boolean {
  return /^[A-Z][\)\.]\s+\S+/.test(text.replace(/\u00a0/g, ' ').trim())
}

export function extractChoiceLabels(questionHtml: string): Record<string, string> {
  const document = createDocument(questionHtml)
  document.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
  const rawText = (document.body.textContent ?? '')
    .replace(/\r/g, '')
    .replace(/([?!.:])\s*([A-Z][\)\.]\s+)/g, '$1\n$2')
  const choiceRegex = /(?:^|\n)\s*([A-Z])[\)\.]\s*(.+?)(?=(?:\n\s*[A-Z][\)\.]\s)|$)/gs
  const labels: Record<string, string> = {}
  let match: RegExpExecArray | null
  while ((match = choiceRegex.exec(rawText)) !== null) {
    const choice = match[1]
    const label = match[2]
    if (choice && label) {
      labels[choice] = label.replace(/\s+/g, ' ').trim()
    }
  }
  return labels
}

export function stripChoicesFromQuestionDisplay(questionHtml: string): string {
  const document = createDocument(questionHtml)
  document.body.querySelectorAll('p, div').forEach((element) => {
    const html = element.innerHTML
    if (!html) {
      return
    }
    const segments = html.split(/<br\s*\/?>/i)
    const meaningful = segments.filter((segment) => {
      const temp = createDocument(segment)
      return (temp.body.textContent ?? '').replace(/\u00a0/g, ' ').trim() !== ''
    })
    if (meaningful.length === 0) {
      return
    }
    const choiceSegments = meaningful.filter((segment) => isChoiceLine(createDocument(segment).body.textContent ?? ''))
    if (choiceSegments.length === 0) {
      return
    }
    if (choiceSegments.length === meaningful.length) {
      element.remove()
      return
    }
    const keptSegments = segments.filter((segment) => {
      const text = (createDocument(segment).body.textContent ?? '').replace(/\u00a0/g, ' ').trim()
      return text === '' || !isChoiceLine(text)
    })
    element.innerHTML = keptSegments.join('<br>').replace(/^(?:\s|<br\s*\/?>)+|(?:\s|<br\s*\/?>)+$/gi, '')
    if ((element.textContent ?? '').replace(/\u00a0/g, ' ').trim() === '') {
      element.remove()
    }
  })
  return document.body.innerHTML
}

export function rewriteAssetPaths(html: string, basePath: string, maxHeight: string): string {
  const document = createDocument(html)

  document.querySelectorAll('img').forEach((image) => {
    const nextSource = resolveAssetPath(basePath, image.getAttribute('src'))
    if (nextSource) {
      image.setAttribute('src', nextSource)
    }
    image.setAttribute('style', `max-width: 100%; max-height: ${maxHeight};`)
    image.setAttribute('data-openable-image', 'true')
  })

  document.querySelectorAll('audio').forEach((audio) => {
    const source = audio.getAttribute('src') || audio.querySelector('source')?.getAttribute('src') || null
    const nextSource = resolveAssetPath(basePath, source)
    if (nextSource) {
      audio.setAttribute('src', nextSource)
      const sourceNode = audio.querySelector('source')
      if (sourceNode) {
        sourceNode.setAttribute('src', nextSource)
      }
    }
  })

  document.querySelectorAll('video').forEach((video) => {
    const nextSource = resolveAssetPath(basePath, video.getAttribute('src'))
    if (nextSource) {
      video.setAttribute('src', nextSource)
    }
  })

  document.querySelectorAll('a').forEach((anchor) => {
    const nextHref = resolveAssetPath(basePath, anchor.getAttribute('href'))
    if (nextHref) {
      anchor.setAttribute('href', nextHref)
    }
  })

  return sanitizeLegacyHtml(document.body.innerHTML)
}

interface CachedAssets {
  questionHtml: string
  explanationHtml: string
}

// In-memory cache keyed by `${basePath}::${qid}`. Question HTML is small
// (usually a few KB) and fetching adds noticeable lag when navigating between
// questions, so we keep the last N entries hot.
const QUESTION_ASSET_CACHE = new Map<string, CachedAssets | Promise<CachedAssets>>()
const QUESTION_ASSET_CACHE_LIMIT = 64

function cacheKey(basePath: string, qid: string): string {
  return `${basePath}::${qid}`
}

function trimCache(): void {
  while (QUESTION_ASSET_CACHE.size > QUESTION_ASSET_CACHE_LIMIT) {
    const oldest = QUESTION_ASSET_CACHE.keys().next().value
    if (!oldest) {
      return
    }
    QUESTION_ASSET_CACHE.delete(oldest)
  }
}

async function fetchQuestionAssetsUncached(basePath: string, qid: string): Promise<CachedAssets> {
  const [questionResponse, explanationResponse] = await Promise.all([
    window.fetch(appendRelativeToBasePath(basePath, `${qid}-q.html`), { credentials: 'include' }),
    window.fetch(appendRelativeToBasePath(basePath, `${qid}-s.html`), { credentials: 'include' })
  ])

  if (!questionResponse.ok || !explanationResponse.ok) {
    throw new Error('Unable to load question content.')
  }

  const [questionHtml, explanationHtml] = await Promise.all([
    questionResponse.text(),
    explanationResponse.text()
  ])

  return { questionHtml, explanationHtml }
}

export async function fetchQuestionAssets(basePath: string, qid: string): Promise<CachedAssets> {
  if (!basePath || !qid) {
    throw new Error('Unable to load question content.')
  }
  const key = cacheKey(basePath, qid)
  const cached = QUESTION_ASSET_CACHE.get(key)
  if (cached && !(cached instanceof Promise)) {
    return cached
  }
  if (cached instanceof Promise) {
    return cached
  }
  const pending = fetchQuestionAssetsUncached(basePath, qid)
    .then((assets) => {
      QUESTION_ASSET_CACHE.set(key, assets)
      trimCache()
      return assets
    })
    .catch((error) => {
      QUESTION_ASSET_CACHE.delete(key)
      throw error
    })
  QUESTION_ASSET_CACHE.set(key, pending)
  return pending
}

/**
 * Kick off a background fetch for a question's assets without awaiting it.
 * The promise is still cached, so a subsequent `fetchQuestionAssets` call
 * resolves immediately once the prefetch completes.
 */
export function prefetchQuestionAssets(basePath: string, qid: string): void {
  if (!basePath || !qid) {
    return
  }
  const key = cacheKey(basePath, qid)
  if (QUESTION_ASSET_CACHE.has(key)) {
    return
  }
  void fetchQuestionAssets(basePath, qid).catch(() => {
    // Swallow errors; the on-demand fetch will surface them.
  })
}

/**
 * Warm the browser image cache by issuing Image() loads for every
 * `data-openable-image` URL in the supplied HTML. This runs in the
 * background so the next render paints instantly.
 */
export function prefetchImagesFromHtml(html: string): void {
  if (!html || typeof window === 'undefined') {
    return
  }
  try {
    const document = createDocument(html)
    const images = document.querySelectorAll<HTMLImageElement>('img[src]')
    images.forEach((image) => {
      const src = image.getAttribute('src')
      if (!src) {
        return
      }
      // new Image() uses the browser's normal cache. Setting src triggers a
      // GET with credentials matching the page. No handlers needed — we just
      // want it cached by the time the user clicks Next.
      const preload = new window.Image()
      preload.decoding = 'async'
      preload.src = src
    })
  } catch {
    // Parsing can fail on malformed snippets; ignore.
  }
}
