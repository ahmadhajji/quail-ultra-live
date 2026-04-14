import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchQuestionAssets, extractChoiceLabels, rewriteAssetPaths, stripChoicesFromQuestionDisplay } from '../lib/qbank-html'
import { getQuestionHighlight, getQuestionNote, setQuestionHighlight, setQuestionNote } from '../lib/annotations'
import { addToBucket, isInBucket, removeFromBucket } from '../lib/progress'
import { syncProgress } from '../lib/api'
import { navigate } from '../lib/navigation'
import { mountQuestionHighlighter } from '../lib/text-highlighting'
import { usePackPage } from '../lib/usePackPage'
import { ExamShellV2 } from '../components/exam/ExamShellV2'
import type { Mode, QbankInfo, SyncProgressOptions } from '../types/domain'

function modeLabel(mode: Mode): string {
  if (mode === 'timed') {
    return 'Timed'
  }
  if (mode === 'untimed') {
    return 'Untimed'
  }
  return 'Tutor'
}

function formatClock(totalSeconds: number): string {
  const absSeconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(absSeconds / 3600)}:${Math.floor((absSeconds % 3600) / 60).toString().padStart(2, '0')}:${Math.floor(absSeconds % 60).toString().padStart(2, '0')}`
}

export function ExamViewPage() {
  const { loading, packId, qbankinfo, setQbankinfo } = usePackPage()
  const qbankinfoRef = useRef<QbankInfo | null>(qbankinfo)
  const timerIntervalRef = useRef<number | null>(null)
  const timerStartedAtRef = useRef(0)
  const timerBaseElapsedRef = useRef(0)
  const timeWarningRef = useRef(true)
  const scrollToExplanationRef = useRef(false)
  const highlighterRef = useRef<ReturnType<typeof mountQuestionHighlighter> | null>(null)
  const questionBodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [selectedQnum, setSelectedQnum] = useState(0)
  const [questionHtml, setQuestionHtml] = useState('')
  const [explanationHtml, setExplanationHtml] = useState('')
  const [choiceLabels, setChoiceLabels] = useState<Record<string, string>>({})
  const [sourceSlideOpen, setSourceSlideOpen] = useState(false)
  const [highlightColor, setHighlightColor] = useState('#fff59d')
  const [noteText, setNoteText] = useState('')
  const [timerLabel, setTimerLabel] = useState('Time Used')
  const [timerText, setTimerText] = useState('0:00:00')
  const examUiMode = useMemo<'legacy' | 'v2'>(() => {
    return new URLSearchParams(window.location.search).get('ui') === 'v2' ? 'v2' : 'legacy'
  }, [])
  const showV2Drawer = examUiMode === 'v2'

  useEffect(() => {
    qbankinfoRef.current = qbankinfo
  }, [qbankinfo])

  useEffect(() => {
    document.body.dataset.examUi = examUiMode
    return () => {
      delete document.body.dataset.examUi
    }
  }, [examUiMode])

  const blockKey = qbankinfo?.blockToOpen ?? ''
  const block = blockKey && qbankinfo ? qbankinfo.progress.blockhist[blockKey] : undefined
  const blockqlist = block?.blockqlist ?? []
  const numQuestions = blockqlist.length
  const currentQid = blockqlist[selectedQnum] ?? ''
  const currentMeta = qbankinfo?.questionMeta?.[currentQid]
  const currentState = block?.questionStates[selectedQnum]
  const currentAnswer = block?.answers[selectedQnum] ?? ''
  const explanationVisible = Boolean(block && currentState && (block.complete || (block.mode === 'tutor' && currentState.revealed)))
  const tutorReviewReady = Boolean(block && !block.complete && block.mode === 'tutor' && block.blockqlist.every((_, index) => block.questionStates[index]?.submitted))
  const metadataChoiceLabels = currentMeta?.choice_text_by_letter ?? {}
  const displayChoices = currentMeta?.choice_presentation?.display_order?.length
    ? currentMeta.choice_presentation.display_order
    : (qbankinfo?.choices[currentQid]?.options ?? [])
  const factCheck = currentMeta?.fact_check
  const warningList = currentMeta?.warnings ?? []
  const showCaution = Boolean(
    (factCheck?.status && ['disputed', 'unresolved'].includes(factCheck.status)) || warningList.length > 0
  )
  const sourceSlideAsset = currentMeta?.source_slide?.expandable && currentMeta?.source_slide?.asset_path
    ? `${qbankinfo?.path}/${currentMeta.source_slide.asset_path.replace(/^\.?\//, '')}`
    : ''

  useEffect(() => {
    if (block) {
      setSelectedQnum(Math.min(block.currentquesnum, Math.max(block.blockqlist.length - 1, 0)))
      timerBaseElapsedRef.current = block.elapsedtime || 0
      timerStartedAtRef.current = 0
      timeWarningRef.current = true
    }
  }, [blockKey])

  useEffect(() => {
    if (!block) {
      setNoteText('')
      return
    }
    setNoteText(getQuestionNote(block, selectedQnum))
  }, [block, selectedQnum])

  const questionRail = useMemo(() => {
    if (!block || !qbankinfo) {
      return []
    }
    return block.blockqlist.map((qid, index) => {
      const state = block.questionStates[index]
      const answer = block.answers[index]
      const classes = ['list-group-item']
      if (answer !== '') {
        classes.push('q-item-answered')
      }
      if (block.complete || (block.mode === 'tutor' && state?.revealed)) {
        classes.push(state?.correct ? 'q-item-correct' : 'q-item-incorrect')
      }
      if (index === selectedQnum) {
        classes.push('active')
      }
      return {
        qid,
        index,
        classes: classes.join(' '),
        flagged: isInBucket(qbankinfo.progress, qbankinfo, qid, 'flagged'),
        state
      }
    })
  }, [block, qbankinfo, selectedQnum])

  function getCurrentBlock(info: QbankInfo | null): QbankInfo['progress']['blockhist'][string] | undefined {
    return info && blockKey ? info.progress.blockhist[blockKey] : undefined
  }

  function mutateCurrentInfo(mutator: (next: QbankInfo) => void): QbankInfo | null {
    const current = qbankinfoRef.current
    if (!current) {
      return null
    }
    const next = structuredClone(current)
    mutator(next)
    qbankinfoRef.current = next
    setQbankinfo(next)
    return next
  }

  async function persistInfo(next: QbankInfo | null, options: SyncProgressOptions = {}): Promise<void> {
    if (!next) {
      return
    }
    await syncProgress(packId, next.progress, options)
  }

  function questionLocked(currentBlock = block, index = selectedQnum): boolean {
    if (!currentBlock) {
      return true
    }
    if (currentBlock.complete) {
      return true
    }
    if (currentBlock.mode === 'tutor') {
      return currentBlock.questionStates[index]?.submitted ?? false
    }
    return false
  }

  function timerShouldRun(currentBlock = block, index = selectedQnum): boolean {
    if (!currentBlock) {
      return false
    }
    if (currentBlock.complete) {
      return false
    }
    if (currentBlock.mode === 'tutor') {
      return !(currentBlock.questionStates[index]?.submitted ?? false)
    }
    return true
  }

  function getLiveElapsedTime(info = qbankinfoRef.current): number {
    const currentBlock = getCurrentBlock(info)
    if (!currentBlock) {
      return 0
    }
    if (currentBlock.complete) {
      return currentBlock.elapsedtime
    }
    if (!timerStartedAtRef.current) {
      return timerBaseElapsedRef.current
    }
    return timerBaseElapsedRef.current + ((Date.now() - timerStartedAtRef.current) / 1000)
  }

  function commitRunningElapsed(info = qbankinfoRef.current): void {
    const currentBlock = getCurrentBlock(info)
    if (!currentBlock || currentBlock.complete || !timerStartedAtRef.current) {
      return
    }
    timerBaseElapsedRef.current = getLiveElapsedTime(info)
    timerStartedAtRef.current = 0
    currentBlock.elapsedtime = timerBaseElapsedRef.current
  }

  async function finishBlock(force = false): Promise<void> {
    const current = qbankinfoRef.current
    const currentBlock = getCurrentBlock(current)
    if (!current || !currentBlock) {
      return
    }

    if (currentBlock.complete) {
      navigate('previousblocks', { pack: packId })
      return
    }

    if (!force && !window.confirm(`${timeWarningRef.current ? '' : 'Time is up.\n'}End block and enter review mode?`)) {
      return
    }

    commitRunningElapsed(current)
    const next = mutateCurrentInfo((draft) => {
      const nextBlock = draft.progress.blockhist[blockKey]!
      nextBlock.complete = true
      nextBlock.currentquesnum = selectedQnum
      let numCorrect = 0
      nextBlock.blockqlist.forEach((qid, index) => {
        const answer = nextBlock.answers[index] ?? ''
        const correctChoice = draft.choices[qid]?.correct ?? ''
        const state = nextBlock.questionStates[index]!
        state.submitted = answer !== ''
        state.revealed = true
        state.correct = answer !== '' && answer === correctChoice
        if (state.correct) {
          numCorrect += 1
          if (isInBucket(draft.progress, draft, qid, 'incorrects')) {
            removeFromBucket(draft.progress, draft, qid, 'incorrects')
          }
        } else if (!isInBucket(draft.progress, draft, qid, 'incorrects')) {
          addToBucket(draft.progress, draft, qid, 'incorrects')
        }
      })
      nextBlock.numcorrect = numCorrect
      nextBlock.elapsedtime = timerBaseElapsedRef.current
    })
    await persistInfo(next, { immediate: true })
    navigate('previousblocks', { pack: packId })
  }

  function updateTimerDisplay(): void {
    const currentBlock = getCurrentBlock(qbankinfoRef.current)
    if (!currentBlock) {
      setTimerLabel('Time Used')
      setTimerText('0:00:00')
      return
    }
    if (currentBlock.complete) {
      setTimerLabel('Time Used')
      setTimerText(formatClock(currentBlock.elapsedtime))
      return
    }
    const elapsed = getLiveElapsedTime()
    if (currentBlock.mode === 'timed') {
      const remaining = currentBlock.timelimit - elapsed
      setTimerLabel('Time Remaining')
      if (remaining >= 0) {
        setTimerText(formatClock(remaining))
      } else {
        setTimerText(`-${formatClock(Math.abs(remaining))}`)
        if (timeWarningRef.current) {
          timeWarningRef.current = false
          void finishBlock(true)
        }
      }
    } else {
      setTimerLabel('Time Used')
      setTimerText(formatClock(elapsed))
    }
  }

  function syncTimerState(): void {
    const current = qbankinfoRef.current
    const currentBlock = getCurrentBlock(current)
    if (!currentBlock) {
      return
    }
    if (currentBlock.complete) {
      commitRunningElapsed(current)
      updateTimerDisplay()
      return
    }
    if (timerShouldRun(currentBlock)) {
      if (!timerStartedAtRef.current) {
        timerStartedAtRef.current = Date.now()
      }
    } else {
      commitRunningElapsed(current)
    }
    updateTimerDisplay()
  }

  function syncQuestionState(info: QbankInfo, index: number): void {
    const currentBlock = info.progress.blockhist[blockKey]
    if (!currentBlock) {
      return
    }
    const state = currentBlock.questionStates[index]
    const qid = currentBlock.blockqlist[index]
    if (!qid) {
      return
    }
    const answer = currentBlock.answers[index] ?? ''
    const correct = info.choices[qid]?.correct ?? ''
    if (!state) {
      return
    }
    if (currentBlock.complete) {
      state.submitted = answer !== ''
      state.revealed = true
      state.correct = answer !== '' && answer === correct
      return
    }
    if (currentBlock.mode === 'tutor') {
      state.correct = answer !== '' && answer === correct
    } else {
      state.submitted = answer !== ''
      state.correct = answer !== '' && answer === correct
    }
  }

  useEffect(() => {
    if (!block || !currentQid || !qbankinfo) {
      return
    }
    let cancelled = false
    void fetchQuestionAssets(qbankinfo.path, currentQid)
      .then(({ questionHtml, explanationHtml }) => {
        if (cancelled) {
          return
        }
        const nextChoiceLabels = extractChoiceLabels(questionHtml)
        const questionMarkup = rewriteAssetPaths(stripChoicesFromQuestionDisplay(questionHtml), qbankinfo.path, `${Math.floor(window.innerHeight * 0.4)}px`)
        const explanationMarkup = rewriteAssetPaths(explanationHtml, qbankinfo.path, `${Math.floor(window.innerHeight * 0.5)}px`)
        setChoiceLabels({ ...nextChoiceLabels, ...metadataChoiceLabels })
        setQuestionHtml(questionMarkup)
        setExplanationHtml(explanationMarkup)
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : 'Unable to load question content.')
      })

    return () => {
      cancelled = true
    }
  }, [block, currentQid, qbankinfo, metadataChoiceLabels])

  useEffect(() => {
    if (!questionHtml) {
      return
    }
    if (scrollRef.current) {
      if (typeof scrollRef.current.scrollTo === 'function') {
        scrollRef.current.scrollTo({ top: 0 })
      } else {
        scrollRef.current.scrollTop = 0
      }
    }
  }, [questionHtml, selectedQnum])

  useEffect(() => {
    if (!block || !questionBodyRef.current) {
      return
    }

    const mountedHighlighter = mountQuestionHighlighter({
      container: questionBodyRef.current,
      color: highlightColor,
      serializedHighlights: getQuestionHighlight(block, selectedQnum),
      onSerializedChange(serialized) {
        const next = mutateCurrentInfo((draft) => {
          const nextBlock = draft.progress.blockhist[blockKey]!
          setQuestionHighlight(nextBlock, selectedQnum, serialized)
        })
        void persistInfo(next)
      }
    })
    highlighterRef.current = mountedHighlighter

    return () => {
      mountedHighlighter.destroy()
      highlighterRef.current = null
    }
  }, [block, blockKey, highlightColor, questionHtml, selectedQnum])

  useEffect(() => {
    highlighterRef.current?.setColor(highlightColor)
  }, [highlightColor])

  useEffect(() => {
    if (scrollToExplanationRef.current && explanationVisible) {
      scrollToExplanationRef.current = false
      document.getElementById('explanationSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [explanationVisible, explanationHtml])

  useEffect(() => {
    if (!block) {
      return
    }
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current)
    }
    timerIntervalRef.current = window.setInterval(() => {
      updateTimerDisplay()
    }, 500)
    syncTimerState()
    return () => {
      if (timerIntervalRef.current !== null) {
        window.clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }
  }, [blockKey])

  useEffect(() => {
    if (block) {
      syncTimerState()
    }
  }, [block, selectedQnum, currentState?.submitted])

  if (loading || !qbankinfo || !block || !currentState) {
    return <div className="d-flex flex-column flex-grow-1 justify-content-center align-items-center"><div className="spinner-border" style={{ width: 72, height: 72 }} role="status" /></div>
  }

  const paneEntries = Object.entries(qbankinfo.panes)

  return (
    <>
      <ExamShellV2
      mode={examUiMode}
      topbar={(
        <header className="exam-topbar">
          <div className="header-left">
            <button className="nav-icon-btn" type="button" onClick={() => navigate('previousblocks', { pack: packId })}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
            </button>
            <div className="exam-question-context">
              <span className="context-item">Item {selectedQnum + 1} of {numQuestions}</span>
              <span className="context-id">Question Id: {currentQid}</span>
            </div>
            <button
              id="btn-flagged"
              className={`btn btn-header-tool ${isInBucket(qbankinfo.progress, qbankinfo, currentQid, 'flagged') ? 'active' : ''}`}
              type="button"
              onClick={() => {
                const next = mutateCurrentInfo((draft) => {
                  if (isInBucket(draft.progress, draft, currentQid, 'flagged')) {
                    removeFromBucket(draft.progress, draft, currentQid, 'flagged')
                  } else {
                    addToBucket(draft.progress, draft, currentQid, 'flagged')
                  }
                })
                void persistInfo(next)
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flag-icon" stroke="currentColor" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
              Mark
            </button>
          </div>

          <div className="header-center">
            <button
              className="btn btn-prevnext"
              type="button"
              disabled={selectedQnum === 0}
              onClick={async () => {
                if (selectedQnum === 0) {
                  return
                }
                commitRunningElapsed()
                const nextIndex = selectedQnum - 1
                const next = mutateCurrentInfo((draft) => {
                  draft.progress.blockhist[blockKey]!.currentquesnum = nextIndex
                })
                setSelectedQnum(nextIndex)
                await persistInfo(next)
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Previous
            </button>
            <button
              className="btn btn-prevnext"
              type="button"
              onClick={async () => {
                if (selectedQnum < numQuestions - 1) {
                  commitRunningElapsed()
                  const nextIndex = selectedQnum + 1
                  const next = mutateCurrentInfo((draft) => {
                    draft.progress.blockhist[blockKey]!.currentquesnum = nextIndex
                  })
                  setSelectedQnum(nextIndex)
                  await persistInfo(next)
                } else {
                  await finishBlock(tutorReviewReady)
                }
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              {selectedQnum === numQuestions - 1 ? (block.complete ? 'Back' : 'Finish') : 'Next'}
            </button>
          </div>

          <div className="header-right">
            <div className="highlight-toolbar">
              {['#fff59d', '#ffd6a5', '#b8f2e6', '#cde7ff'].map((color) => (
                <button key={color} className={`highlight-swatch ${highlightColor === color ? 'active' : ''}`} data-color={color} style={{ background: color }} type="button" onClick={() => setHighlightColor(color)} />
              ))}
            </div>
            {!showV2Drawer && paneEntries.length > 0 ? (
              <div className="btn-group header-panes" role="group">
                {paneEntries.map(([title, pane]) => (
                  <button key={title} className="btn btn-header-tool" type="button" onClick={() => window.open(`${qbankinfo.path}/${pane.file}`, title, pane.prefs)}>
                    {title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </header>
      )}
      rail={(
        <aside className="exam-sidebar">
          <div className="exam-question-list">
            <ul className="list-group">
              {questionRail.map((entry) => (
                <li
                  key={entry.qid + entry.index}
                  className={entry.classes}
                  onClick={async () => {
                    if (entry.index === selectedQnum) {
                      return
                    }
                    commitRunningElapsed()
                    const next = mutateCurrentInfo((draft) => {
                      draft.progress.blockhist[blockKey]!.currentquesnum = entry.index
                    })
                    setSelectedQnum(entry.index)
                    await persistInfo(next)
                  }}
                >
                  <span>{entry.index + 1}</span>
                  {entry.flagged ? <span className="q-flag-dot">F</span> : null}
                  {block.complete || (block.mode === 'tutor' && entry.state?.revealed) ? (
                    <span className={`q-status-dot ${entry.state?.correct ? 'correct' : 'incorrect'}`}>
                      {entry.state?.correct ? '\u2713' : '\u2715'}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
      workspace={(
        <section className="exam-panel exam-panel-continuous">
          <div ref={scrollRef} id="continuousScroll" className="exam-scroll exam-scroll-continuous">
            <section className="exam-section">
              <div ref={questionBodyRef} className="exam-question-body" dangerouslySetInnerHTML={{ __html: questionHtml }} />
              {showCaution ? (
                <div className="alert alert-warning mt-3" role="alert">
                  {factCheck?.status && ['disputed', 'unresolved'].includes(factCheck.status) ? (
                    <p className="mb-2"><strong>Fact-check:</strong> {factCheck.note || `Question marked as ${factCheck.status}.`}</p>
                  ) : null}
                  {warningList.length > 0 ? (
                    <ul className="mb-0 pl-3">
                      {warningList.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="exam-section exam-answer-section">
              {sourceSlideAsset ? (
                <div className="mb-3">
                  <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => setSourceSlideOpen(true)}>
                    Source Slide
                  </button>
                </div>
              ) : null}
              <div className="exam-choices-container">
                <div className="exam-choice-list">
                  {displayChoices.map((choice) => {
                    const showOutcome = block.complete || (block.mode === 'tutor' && currentState.revealed)
                    const correctChoice = qbankinfo.choices[currentQid]?.correct ?? ''
                    const isEliminated = currentState.eliminatedChoices.includes(choice)
                    const isSelected = currentAnswer === choice
                    const stateClasses = [
                      isSelected && !showOutcome ? 'active' : '',
                      isEliminated ? 'choice-eliminated' : '',
                      showOutcome && choice === correctChoice ? 'choice-correct' : '',
                      showOutcome && choice === currentAnswer && choice !== correctChoice ? 'choice-incorrect' : ''
                    ].filter(Boolean).join(' ')
                    return (
                      <div className="exam-choice-row" key={choice}>
                        <button
                          type="button"
                          className={`exam-choice-selector ${stateClasses}`}
                          aria-label={`Select answer ${choice}`}
                          disabled={showOutcome || questionLocked(block) || isEliminated}
                          onClick={() => {
                            if (questionLocked(block)) {
                              return
                            }
                            const next = mutateCurrentInfo((draft) => {
                              const nextBlock = draft.progress.blockhist[blockKey]!
                              const state = nextBlock.questionStates[selectedQnum]!
                              state.eliminatedChoices = state.eliminatedChoices.filter((value) => value !== choice)
                              nextBlock.answers[selectedQnum] = choice
                              syncQuestionState(draft, selectedQnum)
                            })
                            void persistInfo(next)
                          }}
                        />
                        <button
                          type="button"
                          className={`exam-choice-content ${stateClasses}`}
                          disabled={showOutcome || questionLocked(block)}
                          onClick={() => {
                            const next = mutateCurrentInfo((draft) => {
                              const nextBlock = draft.progress.blockhist[blockKey]!
                              const state = nextBlock.questionStates[selectedQnum]!
                              if (state.eliminatedChoices.includes(choice)) {
                                state.eliminatedChoices = state.eliminatedChoices.filter((value) => value !== choice)
                              } else {
                                state.eliminatedChoices.push(choice)
                                if (nextBlock.answers[selectedQnum] === choice) {
                                  nextBlock.answers[selectedQnum] = ''
                                }
                              }
                              syncQuestionState(draft, selectedQnum)
                            })
                            void persistInfo(next)
                          }}
                        >
                          <span className="exam-choice-letter">{choice}</span>
                          <span className="exam-choice-label">{choiceLabels[choice] ?? `Choice ${choice}`}</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="exam-cta-row exam-cta-row-bottom">
                {!block.complete && block.mode === 'tutor' ? (
                  <button
                    className="btn btn-primary btn-submit-uw"
                    type="button"
                    disabled={currentAnswer === '' || currentState.submitted}
                    onClick={async () => {
                      if (currentAnswer === '') {
                        window.alert('Select an answer before submitting.')
                        return
                      }
                      commitRunningElapsed()
                      scrollToExplanationRef.current = true
                      const next = mutateCurrentInfo((draft) => {
                        const nextBlock = draft.progress.blockhist[blockKey]!
                        nextBlock.questionStates[selectedQnum]!.submitted = true
                        nextBlock.questionStates[selectedQnum]!.revealed = true
                        nextBlock.currentquesnum = selectedQnum
                        syncQuestionState(draft, selectedQnum)
                      })
                      await persistInfo(next)
                    }}
                  >
                    {currentState.submitted ? 'Answer Submitted' : 'Submit Answer'}
                  </button>
                ) : null}

                <button
                  className="btn btn-secondary btn-nextques"
                  type="button"
                  disabled={block.mode === 'tutor' && !block.complete ? !currentState.submitted : false}
                  onClick={async () => {
                    if (selectedQnum < numQuestions - 1) {
                      commitRunningElapsed()
                      const nextIndex = selectedQnum + 1
                      const next = mutateCurrentInfo((draft) => {
                        draft.progress.blockhist[blockKey]!.currentquesnum = nextIndex
                      })
                      setSelectedQnum(nextIndex)
                      await persistInfo(next)
                    } else if (block.complete) {
                      navigate('previousblocks', { pack: packId })
                    } else {
                      await finishBlock(tutorReviewReady)
                    }
                  }}
                >
                  {selectedQnum === numQuestions - 1 ? (block.complete ? 'Back to Blocks' : (block.mode === 'tutor' ? 'Finish Review' : 'End Block')) : 'Next Question'}
                </button>
              </div>
            </section>

            <section id="explanationSection" className={`exam-section exam-explanation-section ${explanationVisible ? '' : 'exam-hidden'}`}>
              <div className="exam-section-header">
                <div>
                  <p className="exam-panel-title mb-1">Explanation</p>
                  <p className="exam-panel-note mb-0">
                    {explanationVisible
                      ? (block.complete ? 'Full review is available for this completed block.' : 'Explanation visible immediately after answer submission.')
                      : (block.mode === 'tutor' ? 'Submit the current question to reveal the explanation.' : 'Explanation hidden until you end the block and enter review mode.')}
                  </p>
                </div>
                <div className="d-flex align-items-center" style={{ gap: '0.75rem' }}>
                  {sourceSlideAsset ? (
                    <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => setSourceSlideOpen(true)}>
                      Source Slide
                    </button>
                  ) : null}
                  <span className={`exam-state-pill ${explanationVisible ? 'review' : 'awaiting'}`}>{explanationVisible ? (block.complete ? 'Review' : 'Revealed') : 'Hidden'}</span>
                </div>
              </div>
              {factCheck?.status && ['disputed', 'unresolved'].includes(factCheck.status) ? (
                <div className="alert alert-warning mt-3" role="alert">
                  <p className="mb-2"><strong>Fact-check:</strong> {factCheck.note || `Question marked as ${factCheck.status}.`}</p>
                  {factCheck.sources?.length ? (
                    <ul className="mb-0 pl-3">
                      {factCheck.sources.map((source) => (
                        <li key={source}>
                          <a href={source} target="_blank" rel="noreferrer">{source}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="exam-explanation-body" dangerouslySetInnerHTML={{ __html: explanationHtml }} />
            </section>
          </div>
        </section>
      )}
      drawer={showV2Drawer ? (
        <>
          <section className="exam-v2-drawer-card">
            <p className="exam-v2-drawer-title">Question Notes</p>
            <p className="exam-v2-drawer-copy">Notes and highlights persist per question and follow the current block across refresh, suspend, and resume.</p>
            <textarea
              aria-label="Question Notes"
              className="exam-v2-note-input"
              placeholder="Add your note for this question..."
              value={noteText}
              onChange={(event) => {
                const value = event.target.value
                setNoteText(value)
                const next = mutateCurrentInfo((draft) => {
                  const nextBlock = draft.progress.blockhist[blockKey]!
                  setQuestionNote(nextBlock, selectedQnum, value)
                })
                void persistInfo(next)
              }}
            />
          </section>

          <section className="exam-v2-drawer-card">
            <p className="exam-v2-drawer-title">Annotations</p>
            <p className="exam-v2-drawer-copy">Current question highlight payload: {getQuestionHighlight(block, selectedQnum) === '[]' ? 'none saved' : 'saved locally and queued to sync'}</p>
            <div className="highlight-toolbar">
              {['#fff59d', '#ffd6a5', '#b8f2e6', '#cde7ff'].map((color) => (
                <button key={`drawer-${color}`} className={`highlight-swatch ${highlightColor === color ? 'active' : ''}`} data-color={color} style={{ background: color }} type="button" onClick={() => setHighlightColor(color)} />
              ))}
            </div>
          </section>

          {paneEntries.length > 0 ? (
            <section className="exam-v2-drawer-card">
              <p className="exam-v2-drawer-title">Reference Panes</p>
              <div className="exam-v2-panes">
                {paneEntries.map(([title, pane]) => (
                  <button key={title} className="btn btn-outline-primary btn-sm" type="button" onClick={() => window.open(`${qbankinfo.path}/${pane.file}`, title, pane.prefs)}>
                    {title}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      footer={(
        <footer className="exam-footer">
          <div className="footer-left">
            <div className="footer-timer">
              <span className="time-label">{timerLabel}</span>
              <span className="time-value">{timerText}</span>
            </div>
            <div className="footer-mode">
              <span className={`mode-label mode-${block.mode}`}>{modeLabel(block.mode).toUpperCase()}</span>
            </div>
          </div>

          <div className="footer-right">
            {!block.complete ? (
              <button
                className="btn btn-footer-tool"
                type="button"
                onClick={async () => {
                  commitRunningElapsed()
                  const next = mutateCurrentInfo((draft) => {
                    draft.progress.blockhist[blockKey]!.currentquesnum = selectedQnum
                  })
                  await persistInfo(next, { immediate: true })
                  navigate('previousblocks', { pack: packId })
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                <span>Suspend</span>
              </button>
            ) : null}
            <button className="btn btn-footer-tool" type="button" onClick={() => void finishBlock(tutorReviewReady)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
              <span>{block.complete ? 'Back' : 'End Block'}</span>
            </button>
          </div>
        </footer>
      )}
      />
      {sourceSlideOpen && sourceSlideAsset ? (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true">
          <div className="modal-dialog modal-xl modal-dialog-centered" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Source Slide</h5>
                <button type="button" className="close" aria-label="Close source slide" onClick={() => setSourceSlideOpen(false)}>
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="modal-body text-center">
                <img src={sourceSlideAsset} alt="Source slide" style={{ maxWidth: '100%', maxHeight: '75vh' }} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
