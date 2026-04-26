import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { LoadingScreen } from '../components/LoadingScreen'
import { startBlock } from '../lib/api'
import { navigate } from '../lib/navigation'
import { localStore } from '../lib/store'
import { usePackPage } from '../lib/usePackPage'
import type { QbankInfo } from '../types/domain'

type PoolBucket = 'unused' | 'incorrects' | 'flagged' | 'all'

const bucketLabels: Record<PoolBucket, string> = {
  unused: 'Unused',
  incorrects: 'Incorrects',
  flagged: 'Flagged',
  all: 'All',
}

const bucketDescriptions: Record<PoolBucket, string> = {
  unused: 'The pool includes unseen items only, closest to a fresh first pass through the bank.',
  incorrects: 'The pool includes questions you previously missed, useful for targeted remediation.',
  flagged: 'The pool includes only manually flagged questions, a curated revisit set.',
  all: 'Every question in the bank can be pulled into the block, subject to any active filters.',
}

const tutorModeSummary: [string, string] = ['Tutor mode', 'Submit each question individually and reveal the explanation immediately after you lock the answer.']

function filterInt(value: string): number | undefined {
  if (/^[-+]?(\d+|Infinity)$/.test(value)) {
    const number = Number(value)
    return Number.isFinite(number) ? number : undefined
  }
  return undefined
}

function getStoredMode(): 'tutor' {
  return 'tutor'
}

function setStoredMode(): void {
  localStore.set('mode-setting', 'tutor')
  localStore.set('timed-setting', false)
  localStore.set('showans-setting', true)
}

function getRandom(values: string[], count: number): string[] {
  const result = new Array<string>(count)
  let len = values.length
  const taken = new Array<number>(len)
  let remaining = count
  while (remaining) {
    const index = Math.floor(Math.random() * len)
    result[remaining - 1] = values[index in taken ? taken[index]! : index]!
    taken[index] = (len - 1) in taken ? taken[len - 1]! : len - 1
    len -= 1
    remaining -= 1
  }
  return result
}

function parseCustomIds(qbankinfo: QbankInfo, customIds: string): { qlist: string[]; error: string } {
  const idString = customIds.replace(/ /g, '')
  const customList = idString.split(',').filter(Boolean)
  const qindex = Object.keys(qbankinfo.index)
  for (const customId of customList) {
    if (!qindex.includes(customId)) {
      return { qlist: [], error: `Question ID "${customId}" not found in qbank.` }
    }
  }
  return { qlist: customList, error: '' }
}

function getPrev(qbankinfo: QbankInfo, qid: string): string | null {
  return qbankinfo.groups[qid]?.prev ?? null
}

function getNext(qbankinfo: QbankInfo, qid: string): string | null {
  return qbankinfo.groups[qid]?.next ?? null
}

function handleGrouped(qbankinfo: QbankInfo, blockqlist: string[]): string[] {
  const nextList = [...blockqlist]
  const desiredLength = nextList.length

  for (let index = 0; index < nextList.length; index += 1) {
    const next = getNext(qbankinfo, nextList[index]!)
    if (!next) {
      continue
    }
    for (let removeIndex = 0; removeIndex < nextList.length; removeIndex += 1) {
      if (nextList[removeIndex] === next) {
        nextList.splice(removeIndex, 1)
        removeIndex -= 1
      }
    }
    nextList.splice(index + 1, 0, next)
  }

  for (let index = nextList.length - 1; index >= 0; index -= 1) {
    const prev = getPrev(qbankinfo, nextList[index]!)
    if (!prev) {
      continue
    }
    for (let removeIndex = 0; removeIndex < nextList.length; removeIndex += 1) {
      if (nextList[removeIndex] === prev) {
        nextList.splice(removeIndex, 1)
        removeIndex -= 1
      }
    }
    nextList.splice(index, 0, prev)
    index += 1
  }

  let numToCut = nextList.length - desiredLength
  let index = 0
  while (index < nextList.length && numToCut > 0) {
    let moveForward = true
    let width = numToCut - 1
    while (numToCut > 0 && width >= 0) {
      const startId = nextList[index]
      const endId = nextList[index + width]
      if (startId && endId && getPrev(qbankinfo, startId) === null && getNext(qbankinfo, endId) === null) {
        nextList.splice(index, width + 1)
        numToCut -= width + 1
        moveForward = false
      }
      width = Math.min(width - 1, numToCut - 1)
    }
    if (moveForward) {
      index += 1
    }
  }

  return nextList
}

function countForSubtag(
  qbankinfo: QbankInfo,
  tag: string,
  subtag: string,
  poolChecked: Set<PoolBucket>
): number {
  const bucket = qbankinfo.progress.tagbuckets[tag]?.[subtag]
  if (!bucket) return 0
  const ids = new Set<string>()
  for (const b of poolChecked) {
    for (const id of (bucket[b] ?? [])) ids.add(id)
  }
  return ids.size
}

function getInitialPoolChecked(): Set<PoolBucket> {
  const stored = localStore.getString('pool-buckets')
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as PoolBucket[]
      if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed)
    } catch { /* ignore */ }
  }
  // migrate from old single-select format
  const old = localStore.getString('qpool-setting')
  if (old === 'btn-qpool-incorrects') return new Set<PoolBucket>(['incorrects'])
  if (old === 'btn-qpool-flagged') return new Set<PoolBucket>(['flagged'])
  if (old === 'btn-qpool-all') return new Set<PoolBucket>(['all'])
  return new Set<PoolBucket>(['unused'])
}

export function NewBlockPage() {
  const { loading, user, packId, packName, qbankinfo } = usePackPage()
  const [mode] = useState<'tutor'>(getStoredMode())
  const [poolChecked, setPoolChecked] = useState<Set<PoolBucket>>(getInitialPoolChecked)
  const [customMode, setCustomMode] = useState(localStore.get<boolean>('pool-custom') ?? false)
  const [customIds, setCustomIds] = useState(localStore.getString('custom-ids-setting') ?? '')
  const [numQuestionsText, setNumQuestionsText] = useState(String(localStore.get<number>('numq-setting') ?? ''))
  const [timePerQuestionText, setTimePerQuestionText] = useState(String(localStore.get<number>('timeperq-setting') ?? ''))
  const [sequential, setSequential] = useState(localStore.get<boolean>('sequential-setting') ?? false)
  const [allSubtagsMap, setAllSubtagsMap] = useState<Record<string, boolean>>({})
  const [selectedSubtagsMap, setSelectedSubtagsMap] = useState<Record<string, Record<string, boolean>>>({})
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setStoredMode()
  }, [mode])

  useEffect(() => {
    localStore.set('pool-buckets', JSON.stringify([...poolChecked]))
  }, [poolChecked])

  useEffect(() => {
    localStore.set('pool-custom', customMode)
  }, [customMode])

  useEffect(() => {
    localStore.set('custom-ids-setting', customIds)
  }, [customIds])

  useEffect(() => {
    const parsed = filterInt(numQuestionsText)
    if (parsed !== undefined) {
      localStore.set('numq-setting', parsed)
    } else if (numQuestionsText === '') {
      localStore.remove('numq-setting')
    }
  }, [numQuestionsText])

  useEffect(() => {
    const parsed = filterInt(timePerQuestionText)
    if (parsed !== undefined) {
      localStore.set('timeperq-setting', parsed)
    } else if (timePerQuestionText === '') {
      localStore.remove('timeperq-setting')
    }
  }, [timePerQuestionText])

  useEffect(() => {
    localStore.set('sequential-setting', sequential)
  }, [sequential])

  useEffect(() => {
    if (!qbankinfo) {
      return
    }
    const tags = Object.keys(qbankinfo.tagnames.tagnames)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => qbankinfo.tagnames.tagnames[key] ?? '')
      .filter(Boolean)
    const nextAllSubtags: Record<string, boolean> = {}
    const nextSelected: Record<string, Record<string, boolean>> = {}
    const nextExpanded: Record<string, boolean> = {}
    for (const tag of tags) {
      nextAllSubtags[tag] = true
      nextSelected[tag] = {}
      Object.keys(qbankinfo.progress.tagbuckets[tag] ?? {}).sort().forEach((subtag) => {
        const tagSelection = nextSelected[tag]
        if (tagSelection) {
          tagSelection[subtag] = false
        }
      })
      nextExpanded[tag] = false
    }
    setAllSubtagsMap(nextAllSubtags)
    setSelectedSubtagsMap(nextSelected)
    setExpandedTags(nextExpanded)
  }, [qbankinfo])

  const tags = useMemo(() => {
    if (!qbankinfo) {
      return []
    }
    return Object.keys(qbankinfo.tagnames.tagnames)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => qbankinfo.tagnames.tagnames[key] ?? '')
      .filter(Boolean)
  }, [qbankinfo])

  const subtags = useMemo(() => {
    if (!qbankinfo) {
      return {}
    }
    return Object.fromEntries(tags.map((tag) => [tag, Object.keys(qbankinfo.progress.tagbuckets[tag] ?? {}).sort()])) as Record<string, string[]>
  }, [qbankinfo, tags])

  const poolBadgeCounts = useMemo(() => {
    if (!qbankinfo || tags.length === 0) {
      return { unused: 0, incorrects: 0, flagged: 0, all: 0 }
    }
    const primaryTag = tags[0]!
    return (subtags[primaryTag] ?? []).reduce((acc, subtag) => {
      const bucket = qbankinfo.progress.tagbuckets[primaryTag]?.[subtag]
      if (!bucket) {
        return acc
      }
      acc.unused += bucket.unused.length
      acc.incorrects += bucket.incorrects.length
      acc.flagged += bucket.flagged.length
      acc.all += bucket.all.length
      return acc
    }, { unused: 0, incorrects: 0, flagged: 0, all: 0 })
  }, [qbankinfo, subtags, tags])

  const available = useMemo(() => {
    if (!qbankinfo) {
      return { qlist: [], tagschosenstr: '', allsubtagsenabled: true, error: '' }
    }
    if (customMode) {
      const parsed = parseCustomIds(qbankinfo, customIds)
      return {
        qlist: parsed.qlist,
        tagschosenstr: '<b><u>Custom:</u></b> User supplied question IDs',
        allsubtagsenabled: true,
        error: parsed.error
      }
    }

    let qlist: string[] = []
    let tagschosenstr = ''
    let allSubtagsEnabled = true

    tags.forEach((tag, index) => {
      tagschosenstr += `<b><u>${tag}:</u></b> `
      const tagIdSet = new Set<string>()
      const useAllSubtags = allSubtagsMap[tag] ?? true
      if (useAllSubtags) {
        tagschosenstr += 'All Subtags, '
      } else {
        allSubtagsEnabled = false
      }
      ;(subtags[tag] ?? []).forEach((subtag) => {
        const subtagIds = new Set<string>()
        for (const bucket of poolChecked) {
          for (const id of (qbankinfo.progress.tagbuckets[tag]?.[subtag]?.[bucket] ?? [])) {
            subtagIds.add(id)
          }
        }
        if (useAllSubtags || selectedSubtagsMap[tag]?.[subtag]) {
          for (const id of subtagIds) tagIdSet.add(id)
          if (!useAllSubtags) {
            tagschosenstr += `${subtag}, `
          }
        }
      })
      const tagqlist = [...tagIdSet]
      if (index === 0) {
        qlist = tagqlist
      } else {
        qlist = qlist.filter((qid) => tagIdSet.has(qid))
      }
      tagschosenstr += '<br />'
    })

    return {
      qlist,
      tagschosenstr,
      allsubtagsenabled: allSubtagsEnabled,
      error: ''
    }
  }, [allSubtagsMap, customIds, customMode, poolChecked, qbankinfo, selectedSubtagsMap, subtags, tags])

  if (loading || !qbankinfo) {
    return (
      <AppShell user={user} active="newblock" packId={packId} packName={packName} title="New Block">
        <LoadingScreen />
      </AppShell>
    )
  }

  const selectedNumQuestions = filterInt(numQuestionsText)
  const showTagFilters = !customMode && !(tags.length === 1 && (subtags[tags[0]!] ?? []).length === 1)
  const isAllTags = tags.every((tag) => allSubtagsMap[tag] ?? true)

  const poolSummaryTitle = customMode
    ? 'Custom question IDs'
    : poolChecked.size === 0
      ? 'No pool selected'
      : [...poolChecked].map((b) => bucketLabels[b]).join(' + ')

  const poolSummaryCopy = customMode
    ? 'This block is driven by the IDs you pasted, which is useful for recreating specific sets or checklists.'
    : poolChecked.size === 0
      ? 'Select at least one pool type above to build a block.'
      : [...poolChecked].map((b) => bucketDescriptions[b]).join(' ')

  return (
    <AppShell
      user={user}
      active="newblock"
      packId={packId}
      packName={packName}
      title={packName ? `${packName} — New Block` : 'New Block'}
    >
      <div className="flex-fill">
        <div className="q-page-grid">
          <div className="q-stack">
            <div className="q-panel">
              <div className="q-panel-header">
                <div>
                  <p className="q-panel-title">Study Mode</p>
                </div>
                <span className="q-badge">{tutorModeSummary[0]}</span>
              </div>
              <div className="q-panel-body">
                <div className="q-mode-grid">
                  <button className="q-mode-btn active" type="button">
                    <span className="q-mode-kicker">Immediate Review</span>
                    <span className="q-mode-title">Tutor</span>
                    <span className="q-mode-copy">Submit one question at a time, reveal the rationale instantly, and move through the block as guided review.</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="q-panel">
              <div className="q-panel-header">
                <div>
                  <p className="q-panel-title">Question Pool</p>
                </div>
              </div>
              <div className="q-panel-body">
                <div className="q-pool-options">
                  {(['unused', 'incorrects', 'flagged', 'all'] as PoolBucket[]).map((bucket) => {
                    const isChecked = !customMode && poolChecked.has(bucket)
                    return (
                      <label
                        key={bucket}
                        className={`q-pool-option${isChecked ? ' checked' : ''}${customMode ? ' disabled' : ''}`}
                        htmlFor={`pool-${bucket}`}
                      >
                        <input
                          type="checkbox"
                          className="q-filter-checkbox"
                          id={`pool-${bucket}`}
                          checked={isChecked}
                          disabled={customMode}
                          onChange={(e) => {
                            const next = new Set(poolChecked)
                            if (e.target.checked) {
                              next.add(bucket)
                            } else {
                              next.delete(bucket)
                            }
                            if (next.size > 0) setPoolChecked(next)
                          }}
                        />
                        <span className="q-filter-title">{bucketLabels[bucket]}</span>
                        <span className="q-count-pill">{poolBadgeCounts[bucket]}</span>
                      </label>
                    )
                  })}
                  <label
                    className={`q-pool-option${customMode ? ' checked' : ''}`}
                    htmlFor="pool-custom"
                  >
                    <input
                      type="checkbox"
                      className="q-filter-checkbox"
                      id="pool-custom"
                      checked={customMode}
                      onChange={(e) => setCustomMode(e.target.checked)}
                    />
                    <span className="q-filter-title">Custom IDs</span>
                  </label>
                </div>

                {customMode ? (
                  <div className="mt-3">
                    <p className="q-helper-copy mb-2">Paste question IDs separated by commas. Grouping rules still apply when related questions must stay together.</p>
                    <textarea
                      className="q-textarea"
                      value={customIds}
                      onChange={(event) => setCustomIds(event.target.value)}
                      onBlur={() => {
                        if (available.error) {
                          window.alert(`Error parsing question list: ${available.error}`)
                        }
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {showTagFilters ? (
              <div className="q-panel">
                <div className="q-panel-header">
                  <div>
                    <p className="q-panel-title">Subjects and Filters</p>
                  </div>
                </div>
                <div className="q-panel-body">
                  <div className="q-segmented" role="group">
                    <button
                      className={`btn ${isAllTags ? 'btn-primary' : 'btn-light'}`}
                      type="button"
                      onClick={() => {
                        const nextAll = Object.fromEntries(tags.map((tag) => [tag, true])) as Record<string, boolean>
                        const nextSelected = Object.fromEntries(tags.map((tag) => [
                          tag,
                          Object.fromEntries((subtags[tag] ?? []).map((subtag) => [subtag, false]))
                        ])) as Record<string, Record<string, boolean>>
                        setAllSubtagsMap(nextAll)
                        setSelectedSubtagsMap(nextSelected)
                      }}
                    >
                      All Tags
                    </button>
                    <button className={`btn ${!isAllTags ? 'btn-primary' : 'btn-light'}`} type="button" disabled={isAllTags}>
                      Filtered
                    </button>
                  </div>
                  <div className="accordion q-accordion mt-3">
                    {tags.map((tag) => (
                      <div className="card" key={tag}>
                        <div className="card-header" role="tab">
                          <h5 className="mb-0">
                            <button
                              className="q-accordion-toggle"
                              type="button"
                              aria-expanded={expandedTags[tag] ? 'true' : 'false'}
                              onClick={() => setExpandedTags((current) => ({ ...current, [tag]: !current[tag] }))}
                            >
                              {tag}
                            </button>
                          </h5>
                        </div>
                        {expandedTags[tag] ? (
                          <div className="collapse show" role="tabpanel">
                            <div className="card-body">
                              <label className="q-filter-row" htmlFor={`allsubtags-${tag}`}>
                                <input
                                  type="checkbox"
                                  className="q-filter-checkbox"
                                  id={`allsubtags-${tag}`}
                                  checked={allSubtagsMap[tag] ?? true}
                                  onChange={(event) => {
                                    const checked = event.target.checked
                                    setAllSubtagsMap((current) => ({ ...current, [tag]: checked }))
                                    if (checked) {
                                      setSelectedSubtagsMap((current) => ({
                                        ...current,
                                        [tag]: Object.fromEntries((subtags[tag] ?? []).map((subtag) => [subtag, false]))
                                      }))
                                    }
                                  }}
                                />
                                <span className="q-filter-label">
                                  <span className="q-filter-title">All Subtags</span>
                                </span>
                              </label>
                              <hr />
                              {(subtags[tag] ?? []).map((subtag) => (
                                <label className="q-filter-row mb-2" htmlFor={`subtag-${tag}-${subtag}`} key={subtag}>
                                  <input
                                    type="checkbox"
                                    className="q-filter-checkbox"
                                    id={`subtag-${tag}-${subtag}`}
                                    checked={selectedSubtagsMap[tag]?.[subtag] ?? false}
                                    onChange={(event) => {
                                      const checked = event.target.checked
                                      setSelectedSubtagsMap((current) => ({
                                        ...current,
                                        [tag]: {
                                          ...(current[tag] ?? {}),
                                          [subtag]: checked
                                        }
                                      }))
                                      setAllSubtagsMap((current) => {
                                        if (!checked) {
                                          const stillChecked = Object.entries({
                                            ...(selectedSubtagsMap[tag] ?? {}),
                                            [subtag]: false
                                          }).some(([, selected]) => selected)
                                          return { ...current, [tag]: !stillChecked }
                                        }
                                        return { ...current, [tag]: false }
                                      })
                                    }}
                                  />
                                  <span className="q-filter-label">
                                    <span className="q-filter-title">{subtag}</span>
                                  </span>
                                  <span className="q-count-pill">{countForSubtag(qbankinfo, tag, subtag, poolChecked)}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="q-panel">
              <div className="q-panel-header">
                <div>
                  <p className="q-panel-title">Block Settings</p>
                </div>
              </div>
              <div className="q-panel-body">
                <div className="q-form-grid">
                  <div className="q-metric-box">
                    <div className="q-metric-label">Question Count</div>
                    <div className="q-inline-metric">
                      <input className="q-input" style={{ maxWidth: 130 }} value={numQuestionsText} onChange={(event) => setNumQuestionsText(event.target.value)} />
                      <span className="q-helper-copy">questions</span>
                    </div>
                    <div className="q-inline-metric">
                      <span className="q-badge">{available.qlist.length}</span>
                      <span className="q-helper-copy">available with the current pool and filters</span>
                    </div>
                  </div>
                  <div className="q-metric-box">
                    <div className="q-metric-label">Timing</div>
                    <p className="q-helper-copy mb-0 mt-3">
                      Tutor mode records elapsed time for the block and reveals the explanation immediately after each submission.
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <label className="q-inline-checkbox mb-3" htmlFor="toggle-block-sequential">
                    <input
                      type="checkbox"
                      className="q-filter-checkbox"
                      id="toggle-block-sequential"
                      checked={sequential}
                      onChange={(event) => setSequential(event.target.checked)}
                    />
                    <span>Present question IDs sequentially instead of randomizing them.</span>
                  </label>
                </div>
                <div className="mt-4 d-flex justify-content-start">
                  <button
                    className="btn btn-primary q-start-btn"
                    type="button"
                    onClick={async () => {
                      if (available.error) {
                        window.alert(`Error parsing question list: ${available.error}`)
                        return
                      }
                      if (!selectedNumQuestions) {
                        window.alert('Invalid settings')
                        return
                      }
                      if (selectedNumQuestions > available.qlist.length) {
                        window.alert(`A ${selectedNumQuestions} question block was requested, but only ${available.qlist.length} questions are available with the current settings.`)
                        return
                      }

                      localStore.set('recent-tagschosenstr', available.tagschosenstr)
                      localStore.set('recent-allsubtagsenabled', available.allsubtagsenabled)

                      let blockqlist = sequential
                        ? [...available.qlist].sort((a, b) => Number(a) - Number(b)).slice(0, selectedNumQuestions)
                        : getRandom(available.qlist, selectedNumQuestions)

                      blockqlist = handleGrouped(qbankinfo, blockqlist)
                      if (blockqlist.length !== selectedNumQuestions) {
                        window.alert(`A ${blockqlist.length} question block was necessary due to the inclusion of grouped questions.`)
                      }

                      const result = await startBlock(packId, blockqlist)
                      navigate('examview', { pack: packId, block: result.blockKey })
                    }}
                  >
                    Start Block
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="q-side-summary">
            <div className="q-panel">
              <div className="q-panel-header">
                <div>
                  <p className="q-panel-title">Session Snapshot</p>
                </div>
              </div>
              <div className="q-panel-body">
                <div className="q-summary-list">
                  <div className="q-summary-item">
                    <strong>{tutorModeSummary[0]}</strong>
                    <span>{tutorModeSummary[1]}</span>
                  </div>
                  <div className="q-summary-item">
                    <strong>{poolSummaryTitle}</strong>
                    <span>{poolSummaryCopy}</span>
                  </div>
                  <div className="q-summary-item">
                    <strong>{available.tagschosenstr && !available.allsubtagsenabled ? 'Filtered subject mix' : 'All subjects included'}</strong>
                    <span>
                      {available.tagschosenstr === ''
                        ? 'Filter buckets are intersected across tag groups, so every enabled axis must match.'
                        : available.allsubtagsenabled
                          ? 'Every tag group is currently set to All Subtags, so the pool is not narrowed by subject filters.'
                          : available.tagschosenstr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="q-panel">
              <div className="q-panel-header">
                <div>
                  <p className="q-panel-title">Compatibility Notes</p>
                </div>
              </div>
              <div className="q-panel-body">
                <p className="q-helper-copy mb-3">The builder still honors grouped questions, custom ID lists, pane definitions, and saved progress from older Quail sessions.</p>
                <p className="q-helper-copy mb-0">Legacy blocks will load with derived defaults for mode and review layout, so existing progress files remain readable.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
