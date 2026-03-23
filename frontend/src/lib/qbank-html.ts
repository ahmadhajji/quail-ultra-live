function createDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function resolveAssetPath(basePath: string, rawPath: string | null): string | null {
  if (!rawPath || rawPath.startsWith('data:') || rawPath.startsWith('blob:') || rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    return rawPath
  }
  if (rawPath.startsWith('/api/')) {
    return rawPath
  }
  return `${basePath}/${rawPath.replace(/^\.?\//, '')}`
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

  return document.body.innerHTML
}

export async function fetchQuestionAssets(basePath: string, qid: string): Promise<{ questionHtml: string; explanationHtml: string }> {
  const [questionResponse, explanationResponse] = await Promise.all([
    window.fetch(`${basePath}/${qid}-q.html`, { credentials: 'include' }),
    window.fetch(`${basePath}/${qid}-s.html`, { credentials: 'include' })
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
