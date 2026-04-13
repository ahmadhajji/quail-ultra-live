import { useEffect, useMemo, useState } from 'react'
import { LoadingScreen } from '../components/LoadingScreen'
import { PackTopBar } from '../components/PackTopBar'
import { startBlock } from '../lib/api'
import { navigate } from '../lib/navigation'
import { localStore } from '../lib/store'
import { usePackPage } from '../lib/usePackPage'
import type { QbankInfo } from '../types/domain'

type PoolSetting = 'btn-qpool-unused' | 'btn-qpool-incorrects' | 'btn-qpool-flagged' | 'btn-qpool-all' | 'btn-qpool-custom'

const qpoolSettingToBucket: Record<PoolSetting, 'unused' | 'incorrects' | 'flagged' | 'all' | 'custom'> = {
  'btn-qpool-unused': 'unused',
  'btn-qpool-incorrects': 'incorrects',
  'btn-qpool-flagged': 'flagged',
  'btn-qpool-all': 'all',
  'btn-qpool-custom': 'custom'
}

const qpoolSummaryCopy: Record<PoolSetting, [string, string]> = {
  'btn-qpool-unused': ['Unused questions', 'The pool starts with unseen items only, which is closest to a fresh first pass through the bank.'],
  'btn-qpool-incorrects': ['Incorrect questions', 'This block focuses on questions you previously missed, which is useful for targeted remediation.'],
  'btn-qpool-flagged': ['Flagged questions', 'Only manually flagged questions are eligible, making this block a curated revisit set.'],
  'btn-qpool-all': ['All questions', 'Every question in the bank can be pulled into the block, subject to any active filters.'],
  'btn-qpool-custom': ['Custom question IDs', 'This block is driven by the IDs you pasted, which is useful for recreating specific sets or checklists.']
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

export function NewBlockPage() {
  const { loading, packId, qbankinfo } = usePackPage()
  const [mode] = useState<'tutor'>(getStoredMode())
  const [qpoolSetting, setQpoolSetting] = useState<PoolSetting>((localStore.getString('qpool-setting') as PoolSetting | undefined) ?? 'btn-qpool-unused')
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
    localStore.set('qpool-setting', qpoolSetting)
  }, [qpoolSetting])

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
    const poolToUse = qpoolSettingToBucket[qpoolSetting]
    if (poolToUse === 'custom') {
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
      let tagqlist: string[] = []
      const useAllSubtags = allSubtagsMap[tag] ?? true
      if (useAllSubtags) {
        tagschosenstr += 'All Subtags, '
      } else {
        allSubtagsEnabled = false
      }
      ;(subtags[tag] ?? []).forEach((subtag) => {
        const subtagqlist = qbankinfo.progress.tagbuckets[tag]?.[subtag]?.[poolToUse] ?? []
        if (useAllSubtags || selectedSubtagsMap[tag]?.[subtag]) {
          tagqlist = tagqlist.concat(subtagqlist)
          if (!useAllSubtags) {
            tagschosenstr += `${subtag}, `
          }
        }
      })
      if (index === 0) {
        qlist = tagqlist
      } else {
        qlist = qlist.filter((qid) => tagqlist.includes(qid))
      }
      tagschosenstr += '<br />'
    })

    return {
      qlist,
      tagschosenstr,
      allsubtagsenabled: allSubtagsEnabled,
      error: ''
    }
  }, [allSubtagsMap, customIds, qbankinfo, qpoolSetting, selectedSubtagsMap, subtags, tags])

  if (loading || !qbankinfo) {
    return (
      <div className="container-fluid d-flex flex-column" style={{ height: '100%' }}>
        <LoadingScreen />
      </div>
    )
  }

  const selectedNumQuestions = filterInt(numQuestionsText)
  const selectedTimePerQuestion = filterInt(timePerQuestionText)
  const selectedPoolSummary = qpoolSummaryCopy[qpoolSetting]
  const showTagFilters = !(qpoolSetting === 'btn-qpool-custom' || (tags.length === 1 && (subtags[tags[0]!] ?? []).length === 1))
  const isAllTags = tags.every((tag) => allSubtagsMap[tag] ?? true)

  return (
    <div className="container-fluid d-flex flex-column" style={{ height: '100%' }}>
      <PackTopBar
        subtitle="Session Builder"
        active="newblock"
        onBack={() => navigate('index')}
        onOverview={() => navigate('overview', { pack: packId })}
        onNewBlock={() => navigate('newblock', { pack: packId })}
        onPreviousBlocks={() => navigate('previousblocks', { pack: packId })}
      />

      <div className="flex-fill">
        <div className="q-page-grid">
          <div className="q-stack">
            <div className="q-panel">
              <div className="q-panel-header">
                <div>
                  <p className="q-panel-title">Study Mode</p>
                  <p className="q-panel-subtitle">This build now uses tutor mode only. Timed and untimed sessions are deprecated because they were not reliable.</p>
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
                  <p className="q-panel-subtitle">Build focused blocks from unseen, incorrect, flagged, full-bank, or custom ID lists.</p>
                </div>
              </div>
              <div className="q-panel-body">
                <div className="q-segmented" role="group">
                  {([
                    ['btn-qpool-unused', 'Unused', poolBadgeCounts.unused],
                    ['btn-qpool-incorrects', 'Incorrects', poolBadgeCounts.incorrects],
                    ['btn-qpool-flagged', 'Flagged', poolBadgeCounts.flagged],
                    ['btn-qpool-all', 'All', poolBadgeCounts.all],
                    ['btn-qpool-custom', 'Custom IDs', undefined]
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      className={`btn ${qpoolSetting === key ? 'btn-primary' : 'btn-light'}`}
                      type="button"
                      onClick={() => setQpoolSetting(key)}
                    >
                      {label}
                      {typeof count === 'number' ? <span className="badge badge-pill badge-secondary ml-2">{count}</span> : null}
                    </button>
                  ))}
                </div>

                {qpoolSetting === 'btn-qpool-custom' ? (
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
                    <p className="q-panel-subtitle">Keep all subtags enabled for broad coverage or narrow the block to a specific slice of the bank.</p>
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
                            <button className="btn btn-link p-0" type="button" onClick={() => setExpandedTags((current) => ({ ...current, [tag]: !current[tag] }))}>
                              {tag}
                            </button>
                          </h5>
                        </div>
                        {expandedTags[tag] ? (
                          <div className="collapse show" role="tabpanel">
                            <div className="card-body">
                              <div className="custom-control custom-switch">
                                <input
                                  type="checkbox"
                                  className="custom-control-input"
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
                                <label className="custom-control-label" htmlFor={`allsubtags-${tag}`}>All Subtags</label>
                              </div>
                              <hr />
                              {(subtags[tag] ?? []).map((subtag) => (
                                <div className="custom-control custom-switch mb-2" key={subtag}>
                                  <input
                                    type="checkbox"
                                    className="custom-control-input"
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
                                  <label className="custom-control-label d-md-flex align-items-md-center" htmlFor={`subtag-${tag}-${subtag}`}>
                                    {subtag}
                                    <span className="badge badge-pill badge-secondary ml-2">{qbankinfo.progress.tagbuckets[tag]?.[subtag]?.[qpoolSettingToBucket[qpoolSetting] as 'unused' | 'incorrects' | 'flagged' | 'all']?.length ?? 0}</span>
                                  </label>
                                </div>
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
                  <p className="q-panel-subtitle">Keep the test builder compact, but expose the control points that matter for compatibility with existing Quail Ultra banks.</p>
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
                  <div className="custom-control custom-switch mb-3">
                    <input
                      type="checkbox"
                      className="custom-control-input"
                      id="toggle-block-sequential"
                      checked={sequential}
                      onChange={(event) => setSequential(event.target.checked)}
                    />
                    <label className="custom-control-label" htmlFor="toggle-block-sequential">Present question IDs sequentially instead of randomizing them.</label>
                  </div>
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
                  <p className="q-panel-subtitle">A compact summary of how the block will behave once it opens.</p>
                </div>
              </div>
              <div className="q-panel-body">
                <div className="q-summary-list">
                  <div className="q-summary-item">
                    <strong>{tutorModeSummary[0]}</strong>
                    <span>{tutorModeSummary[1]}</span>
                  </div>
                  <div className="q-summary-item">
                    <strong>{selectedPoolSummary[0]}</strong>
                    <span>{selectedPoolSummary[1]}</span>
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
                  <p className="q-panel-subtitle">Quail Ultra remains BYO question bank, so this UI layer preserves the existing HTML and JSON bank format.</p>
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
    </div>
  )
}
