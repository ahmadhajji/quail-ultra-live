import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchQuestionAssets, extractChoiceLabels, prefetchImagesFromHtml, prefetchQuestionAssets, rewriteAssetPaths, stripChoicesFromQuestionDisplay } from '../lib/qbank-html'
import { getHighlightDoc, getQuestionNote, setHighlightDocTarget, setQuestionNote } from '../lib/annotations'
import { addToBucket, isInBucket, removeFromBucket } from '../lib/progress'
import { syncProgress } from '../lib/api'
import { LAB_VALUE_SECTIONS, type ExamToolKey as ContentExamToolKey } from '../lib/exam-tools'
import { navigate } from '../lib/navigation'
import { isHighlightColor, type SerializedHighlight } from '../lib/highlighting'
import { mountQuestionHighlighter } from '../lib/text-highlighting'
import {
  DEFAULT_UI_PREFS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  FONT_WEIGHT_STEP,
  normalizeFontSizeScale,
  normalizeFontWeightDelta,
  useUiPreferences
} from '../lib/uiPreferences'
import { usePackPage } from '../lib/usePackPage'
import { ExamShellV2 } from '../components/exam/ExamShellV2'
import { FloatingWindow } from '../components/FloatingWindow'
import { ImageInspector, type ImageInspectorItem } from '../components/ImageInspector'
import { SyncStatusPill } from '../components/SyncStatusPill'
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

type CalculatorOperator = 'add' | 'subtract' | 'multiply' | 'divide'
type ExamToolKey = ContentExamToolKey | 'settings'
type MarkerKey = 'none' | 'yellow' | 'green' | 'cyan' | 'red'
type ShortcutPlatform = 'mac' | 'windows'

interface MarkerPreset {
  key: MarkerKey
  label: string
  color: string | null
  accent: string
  shortcut: string
}

interface ShortcutDefinition {
  action: string
  macKeys: string[]
  windowsKeys: string[]
}

const MARKER_PRESETS: MarkerPreset[] = [
  { key: 'none', label: 'None', color: null, accent: '#ffffff', shortcut: '`' },
  { key: 'yellow', label: 'Yellow', color: '#fff59d', accent: '#fff200', shortcut: '1' },
  { key: 'green', label: 'Green', color: '#b8f2e6', accent: '#39ff14', shortcut: '2' },
  { key: 'cyan', label: 'Cyan', color: '#cde7ff', accent: '#22d3ee', shortcut: '3' },
  { key: 'red', label: 'Red', color: '#ffd6d6', accent: '#ff3b30', shortcut: '4' }
]

const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { action: 'Mark Question', macKeys: ['⌥', 'M'], windowsKeys: ['Alt', 'M'] },
  { action: 'Notes', macKeys: ['⌥', 'N'], windowsKeys: ['Alt', 'N'] },
  { action: 'Lab Values', macKeys: ['⌥', 'L'], windowsKeys: ['Alt', 'L'] },
  { action: 'Calculator', macKeys: ['⌥', 'C'], windowsKeys: ['Alt', 'C'] },
  { action: 'Settings', macKeys: ['⌥', ','], windowsKeys: ['Alt', ','] },
  { action: 'Sidebar', macKeys: ['⌥', 'A'], windowsKeys: ['Alt', 'A'] },
  { action: 'Submit Choice', macKeys: ['⌥', 'Enter'], windowsKeys: ['Alt', 'Enter'] },
  { action: 'Highlight Marker - None', macKeys: ['`'], windowsKeys: ['`'] },
  { action: 'Highlight Marker - Yellow', macKeys: ['1'], windowsKeys: ['1'] },
  { action: 'Highlight Marker - Green', macKeys: ['2'], windowsKeys: ['2'] },
  { action: 'Highlight Marker - Cyan', macKeys: ['3'], windowsKeys: ['3'] },
  { action: 'Highlight Marker - Red', macKeys: ['4'], windowsKeys: ['4'] },
  { action: 'Previous Question', macKeys: ['←'], windowsKeys: ['←'] },
  { action: 'Next Question', macKeys: ['→'], windowsKeys: ['→'] },
  { action: 'Full Screen', macKeys: ['⌘', '⌃', 'F'], windowsKeys: ['F11'] },
  { action: 'Shortcuts', macKeys: ['⌥', '/'], windowsKeys: ['Alt', '/'] },
  { action: 'Notebook', macKeys: ['⌥', 'O'], windowsKeys: ['Alt', 'O'] },
  { action: 'Library', macKeys: ['⌥', 'R'], windowsKeys: ['Alt', 'R'] },
  { action: 'Feedback', macKeys: ['⌥', 'F'], windowsKeys: ['Alt', 'F'] },
  { action: 'Split View', macKeys: ['⌥', 'S'], windowsKeys: ['Alt', 'S'] },
  { action: 'Choices', macKeys: ['A', 'B', 'C', 'D'], windowsKeys: ['A', 'B', 'C', 'D'] }
]

function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`)) {
    return 'mac'
  }
  return 'windows'
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function parseSerializedHighlightEntries(serialized: string): SerializedHighlight[] {
  if (!serialized || serialized === '[]') {
    return []
  }
  try {
    const parsed = JSON.parse(serialized)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((entry): entry is SerializedHighlight => (
      entry &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      typeof entry.start === 'number' &&
      typeof entry.end === 'number' &&
      isHighlightColor((entry as { color?: unknown }).color)
    ))
  } catch {
    return []
  }
}

function formatCalculatorValue(value: number): string {
  if (!Number.isFinite(value)) {
    return 'Error'
  }
  const compact = Number(value.toPrecision(10))
  return compact.toString()
}

function calculatorOperatorSymbol(operator: CalculatorOperator): string {
  if (operator === 'add') {
    return '+'
  }
  if (operator === 'subtract') {
    return '-'
  }
  if (operator === 'multiply') {
    return 'x'
  }
  return '/'
}

function applyCalculatorOperation(left: number, right: number, operator: CalculatorOperator): number | null {
  if (operator === 'add') {
    return left + right
  }
  if (operator === 'subtract') {
    return left - right
  }
  if (operator === 'multiply') {
    return left * right
  }
  if (right === 0) {
    return null
  }
  return left / right
}

function parseCalculatorDisplay(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function ExamViewPage() {
  const { loading, packId, qbankinfo, setQbankinfo } = usePackPage()
  const qbankinfoRef = useRef<QbankInfo | null>(qbankinfo)
  const timerIntervalRef = useRef<number | null>(null)
  const notePersistTimeoutRef = useRef<number | null>(null)
  const timerStartedAtRef = useRef(0)
  const timerBaseElapsedRef = useRef(0)
  const timeWarningRef = useRef(true)
  const scrollToExplanationRef = useRef(false)
  const questionHighlighterRef = useRef<ReturnType<typeof mountQuestionHighlighter> | null>(null)
  const explanationHighlighterRef = useRef<ReturnType<typeof mountQuestionHighlighter> | null>(null)
  // Track the last highlight payload written by the engine itself so we can
  // distinguish self-mutations from external changes (e.g. navigating to a
  // new question) without destroying and recreating the engine.
  const ownHighlightPayloadRef = useRef('[]')
  const noteQuestionIndexRef = useRef(0)
  const noteTextRef = useRef('')
  const questionBodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const markerButtonRef = useRef<HTMLButtonElement | null>(null)
  const markerMenuRef = useRef<HTMLDivElement | null>(null)
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false)
  const [markerMenuPosition, setMarkerMenuPosition] = useState({ top: 58, right: 16 })
  const [selectedQnum, setSelectedQnum] = useState(0)
  const [questionHtml, setQuestionHtml] = useState('')
  const [explanationHtml, setExplanationHtml] = useState('')
  const [choiceLabels, setChoiceLabels] = useState<Record<string, string>>({})
  const [sourceSlideOpen, setSourceSlideOpen] = useState(false)
  const [selectedMarker, setSelectedMarker] = useState<MarkerKey>('yellow')
  const [noteText, setNoteText] = useState('')
  const [activeTool, setActiveTool] = useState<ExamToolKey | null>(null)
  const [labSearchTerm, setLabSearchTerm] = useState('')
  const [calculatorDisplay, setCalculatorDisplay] = useState('0')
  const [calculatorStoredValue, setCalculatorStoredValue] = useState<number | null>(null)
  const [calculatorOperator, setCalculatorOperator] = useState<CalculatorOperator | null>(null)
  const [calculatorWaitingForOperand, setCalculatorWaitingForOperand] = useState(false)
  const [calculatorHistory, setCalculatorHistory] = useState('Ready')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [shortcutWindowOpen, setShortcutWindowOpen] = useState(false)
  const [shortcutPlatform, setShortcutPlatform] = useState<ShortcutPlatform>(() => detectShortcutPlatform())
  const [inspectorItem, setInspectorItem] = useState<ImageInspectorItem | null>(null)
  const explanationBodyRef = useRef<HTMLDivElement | null>(null)
  const [fullscreenActive, setFullscreenActive] = useState(Boolean(document.fullscreenElement))
  const [timerLabel, setTimerLabel] = useState('Time Used')
  const [timerText, setTimerText] = useState('0:00:00')
  const [uiPrefs, updateUiPrefs, resetUiPrefs] = useUiPreferences()
  const examUiMode = useMemo<'v2'>(() => 'v2', [])
  const filteredLabSections = useMemo(() => {
    const query = labSearchTerm.trim().toLowerCase()
    if (!query) {
      return LAB_VALUE_SECTIONS
    }
    return LAB_VALUE_SECTIONS
      .map((section) => ({
        ...section,
        rows: section.rows.filter((row) => {
          const searchableText = [row.label, row.conventional, row.si, ...(row.keywords ?? [])].join(' ').toLowerCase()
          return searchableText.includes(query)
        })
      }))
      .filter((section) => section.rows.length > 0)
  }, [labSearchTerm])

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
  const syncedSelectedQnum = block ? Math.min(block.currentquesnum, Math.max(block.blockqlist.length - 1, 0)) : selectedQnum
  const currentQid = blockqlist[selectedQnum] ?? ''
  const currentMeta = qbankinfo?.questionMeta?.[currentQid]
  const currentState = block?.questionStates[selectedQnum]
  const currentAnswer = block?.answers[selectedQnum] ?? ''
  const currentQuestionFlagged = Boolean(qbankinfo && isInBucket(qbankinfo.progress, qbankinfo, currentQid, 'flagged'))
  const qbankPath = qbankinfo?.path ?? ''
  const explanationVisible = Boolean(block && currentState && (block.complete || (block.mode === 'tutor' && currentState.revealed)))
  const tutorReviewReady = Boolean(block && !block.complete && block.mode === 'tutor' && block.blockqlist.every((_, index) => block.questionStates[index]?.submitted))
  const showBottomNextButton = Boolean(block && (block.mode !== 'tutor' || block.complete || currentState?.submitted))
  const metadataChoiceLabels = currentMeta?.choice_text_by_letter ?? {}
  const displayChoices = currentMeta?.choice_presentation?.display_order?.length
    ? currentMeta.choice_presentation.display_order
    : (qbankinfo?.choices[currentQid]?.options ?? [])
  const highlightColor = MARKER_PRESETS.find((preset) => preset.key === selectedMarker)?.color ?? '#fff59d'
  const currentHighlightPayload = block?.highlights[selectedQnum] ?? '[]'
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
      noteTextRef.current = ''
      setNoteText('')
      return
    }
    const nextNote = getQuestionNote(block, selectedQnum)
    noteQuestionIndexRef.current = selectedQnum
    noteTextRef.current = nextNote
    setNoteText(nextNote)
  }, [blockKey, selectedQnum])

  const questionRail = useMemo(() => {
    if (!block || !qbankinfo) {
      return []
    }
    return block.blockqlist.map((qid, index) => {
      const state = block.questionStates[index]
      const classes = ['list-group-item', state?.visited ? 'q-item-visited' : 'q-item-unopened']
      if (block.complete || (block.mode === 'tutor' && state?.revealed)) {
        classes.push(state?.correct ? 'q-item-correct' : 'q-item-incorrect')
      }
      if (index === selectedQnum) {
        classes.push('active', 'q-item-current')
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

  function clearPendingNotePersist(): void {
    if (notePersistTimeoutRef.current !== null) {
      window.clearTimeout(notePersistTimeoutRef.current)
      notePersistTimeoutRef.current = null
    }
  }

  function persistQuestionNote(index: number, value: string, options: SyncProgressOptions = { silent: true }): Promise<void> {
    const currentBlock = getCurrentBlock(qbankinfoRef.current)
    if (!currentBlock || getQuestionNote(currentBlock, index) === value) {
      return Promise.resolve()
    }
    const next = mutateCurrentInfo((draft) => {
      const nextBlock = draft.progress.blockhist[blockKey]!
      nextBlock.questionStates[index]!.visited = true
      setQuestionNote(nextBlock, index, value)
    })
    return persistInfo(next, options)
  }

  function flushPendingNote(options: SyncProgressOptions = { silent: true }): Promise<void> {
    clearPendingNotePersist()
    return persistQuestionNote(noteQuestionIndexRef.current, noteTextRef.current, options)
  }

  function scheduleNotePersist(index: number, value: string): void {
    noteQuestionIndexRef.current = index
    noteTextRef.current = value
    clearPendingNotePersist()
    notePersistTimeoutRef.current = window.setTimeout(() => {
      notePersistTimeoutRef.current = null
      void persistQuestionNote(index, value, { silent: true })
    }, 400)
  }

  function toggleTool(tool: ExamToolKey): void {
    setActiveTool((current) => current === tool ? null : tool)
  }

  function openTool(tool: ExamToolKey): void {
    setActiveTool(tool)
  }

  function closeToolPanel(): void {
    setActiveTool(null)
  }

  function toggleSidebar(): void {
    setSidebarOpen((current) => !current)
  }

  function toggleShortcutsWindow(): void {
    setShortcutWindowOpen((current) => !current)
  }

  function toggleFlaggedQuestion(): void {
    const next = mutateCurrentInfo((draft) => {
      draft.progress.blockhist[blockKey]!.questionStates[selectedQnum]!.visited = true
      if (isInBucket(draft.progress, draft, currentQid, 'flagged')) {
        removeFromBucket(draft.progress, draft, currentQid, 'flagged')
      } else {
        addToBucket(draft.progress, draft, currentQid, 'flagged')
      }
    })
    void persistInfo(next)
  }

  function selectAnswer(choice: string): void {
    if (questionLocked(block)) {
      return
    }
    const currentBlock = block
    if (!currentBlock) {
      return
    }
    const currentQuestionState = currentBlock.questionStates[selectedQnum]
    if (!currentQuestionState || currentQuestionState.eliminatedChoices.includes(choice)) {
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
  }

  async function submitCurrentAnswer(): Promise<void> {
    if (!block || !currentState || block.complete || block.mode !== 'tutor' || currentAnswer === '' || currentState.submitted) {
      return
    }
    await flushPendingNote({ immediate: true, silent: true })
    commitRunningElapsed()
    scrollToExplanationRef.current = true
    const next = mutateCurrentInfo((draft) => {
      const nextBlock = draft.progress.blockhist[blockKey]!
      nextBlock.questionStates[selectedQnum]!.submitted = true
      nextBlock.questionStates[selectedQnum]!.revealed = true
      nextBlock.currentquesnum = selectedQnum
      syncQuestionState(draft, selectedQnum)
    })
    void persistInfo(next)
  }

  async function goToNextQuestionOrFinish(): Promise<void> {
    if (selectedQnum < numQuestions - 1) {
      openQuestion(selectedQnum + 1)
      return
    }
    await finishBlock(tutorReviewReady)
  }

  async function goToBottomNextAction(): Promise<void> {
    if (selectedQnum < numQuestions - 1) {
      openQuestion(selectedQnum + 1)
      return
    }
    if (block?.complete) {
      navigate('previousblocks', { pack: packId })
      return
    }
    await finishBlock(tutorReviewReady)
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.()
      } else {
        await document.documentElement.requestFullscreen?.()
      }
    } catch {
      // Browser/fullscreen availability varies across environments.
    }
  }

  function applyMarker(marker: MarkerKey): void {
    setSelectedMarker(marker)
  }

  function clearAllHighlights(): void {
    questionHighlighterRef.current?.clearAll()
    explanationHighlighterRef.current?.clearAll()
  }

  function positionMarkerMenu(): void {
    const rect = markerButtonRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    setMarkerMenuPosition({
      top: Math.round(rect.bottom + 6),
      right: Math.max(8, Math.round(window.innerWidth - rect.right))
    })
  }

  function openMarkerMenu(): void {
    positionMarkerMenu()
    setActiveTool(null)
    setShortcutWindowOpen(false)
    setMarkerMenuOpen(true)
  }

  function closeMarkerMenu(): void {
    setMarkerMenuOpen(false)
  }

  function toggleMarkerMenu(): void {
    if (markerMenuOpen) {
      closeMarkerMenu()
      return
    }
    openMarkerMenu()
  }

  function resetCalculator(): void {
    setCalculatorDisplay('0')
    setCalculatorStoredValue(null)
    setCalculatorOperator(null)
    setCalculatorWaitingForOperand(false)
    setCalculatorHistory('Ready')
  }

  function setCalculatorError(message: string): void {
    setCalculatorDisplay('Error')
    setCalculatorStoredValue(null)
    setCalculatorOperator(null)
    setCalculatorWaitingForOperand(false)
    setCalculatorHistory(message)
  }

  function inputCalculatorDigit(digit: string): void {
    if (calculatorDisplay === 'Error') {
      setCalculatorDisplay(digit)
      setCalculatorWaitingForOperand(false)
      setCalculatorHistory('Editing')
      return
    }
    if (calculatorWaitingForOperand) {
      setCalculatorDisplay(digit)
      setCalculatorWaitingForOperand(false)
      return
    }
    setCalculatorDisplay((current) => current === '0' ? digit : `${current}${digit}`)
  }

  function inputCalculatorDecimal(): void {
    if (calculatorDisplay === 'Error' || calculatorWaitingForOperand) {
      setCalculatorDisplay('0.')
      setCalculatorWaitingForOperand(false)
      return
    }
    if (!calculatorDisplay.includes('.')) {
      setCalculatorDisplay(`${calculatorDisplay}.`)
    }
  }

  function commitCalculatorOperation(nextOperator: CalculatorOperator | null): void {
    if (calculatorDisplay === 'Error') {
      if (nextOperator === null) {
        resetCalculator()
      }
      return
    }

    const inputValue = parseCalculatorDisplay(calculatorDisplay)

    if (calculatorStoredValue === null) {
      setCalculatorStoredValue(inputValue)
      setCalculatorOperator(nextOperator)
      setCalculatorWaitingForOperand(Boolean(nextOperator))
      setCalculatorHistory(nextOperator ? `${formatCalculatorValue(inputValue)} ${calculatorOperatorSymbol(nextOperator)}` : formatCalculatorValue(inputValue))
      return
    }

    if (calculatorOperator === null) {
      setCalculatorStoredValue(inputValue)
      setCalculatorOperator(nextOperator)
      setCalculatorWaitingForOperand(Boolean(nextOperator))
      setCalculatorHistory(nextOperator ? `${formatCalculatorValue(inputValue)} ${calculatorOperatorSymbol(nextOperator)}` : formatCalculatorValue(inputValue))
      return
    }

    if (calculatorWaitingForOperand && nextOperator) {
      setCalculatorOperator(nextOperator)
      setCalculatorHistory(`${formatCalculatorValue(calculatorStoredValue)} ${calculatorOperatorSymbol(nextOperator)}`)
      return
    }

    const result = applyCalculatorOperation(calculatorStoredValue, inputValue, calculatorOperator)
    if (result === null) {
      setCalculatorError('Cannot divide by zero')
      return
    }

    const formattedResult = formatCalculatorValue(result)
    setCalculatorDisplay(formattedResult)
    setCalculatorStoredValue(nextOperator ? result : null)
    setCalculatorOperator(nextOperator)
    setCalculatorWaitingForOperand(Boolean(nextOperator))
    setCalculatorHistory(
      nextOperator
        ? `${formattedResult} ${calculatorOperatorSymbol(nextOperator)}`
        : `${formatCalculatorValue(calculatorStoredValue)} ${calculatorOperatorSymbol(calculatorOperator)} ${formatCalculatorValue(inputValue)} =`
    )
  }

  function toggleCalculatorSign(): void {
    if (calculatorDisplay === 'Error') {
      resetCalculator()
      return
    }
    const current = parseCalculatorDisplay(calculatorDisplay)
    setCalculatorDisplay(formatCalculatorValue(current * -1))
  }

  function applyCalculatorPercent(): void {
    if (calculatorDisplay === 'Error') {
      resetCalculator()
      return
    }
    const current = parseCalculatorDisplay(calculatorDisplay)
    setCalculatorDisplay(formatCalculatorValue(current / 100))
    setCalculatorHistory(`${formatCalculatorValue(current)} %`)
    setCalculatorWaitingForOperand(false)
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
    let current = qbankinfoRef.current
    let currentBlock = getCurrentBlock(current)
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

    await flushPendingNote({ immediate: true, silent: true })
    current = qbankinfoRef.current
    currentBlock = getCurrentBlock(current)
    if (!current || !currentBlock) {
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
        state.visited = true
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
    state.visited = true
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

  function openQuestion(index: number): void {
    if (index < 0 || index >= numQuestions || index === selectedQnum) {
      return
    }
    void flushPendingNote({ silent: true })
    commitRunningElapsed()
    const next = mutateCurrentInfo((draft) => {
      const nextBlock = draft.progress.blockhist[blockKey]!
      nextBlock.currentquesnum = index
      nextBlock.questionStates[index]!.visited = true
    })
    setSelectedQnum(index)
    void persistInfo(next, { silent: true })
  }

  useEffect(() => {
    if (!currentQid || !qbankPath) {
      return
    }
    if (selectedQnum !== syncedSelectedQnum) {
      return
    }
    let cancelled = false
    void fetchQuestionAssets(qbankPath, currentQid)
      .then(({ questionHtml, explanationHtml }) => {
        if (cancelled) {
          return
        }
        const nextChoiceLabels = extractChoiceLabels(questionHtml)
        const questionMarkup = rewriteAssetPaths(stripChoicesFromQuestionDisplay(questionHtml), qbankPath, `${Math.floor(window.innerHeight * 0.4)}px`)
        const explanationMarkup = rewriteAssetPaths(explanationHtml, qbankPath, `${Math.floor(window.innerHeight * 0.5)}px`)
        setChoiceLabels({ ...nextChoiceLabels, ...metadataChoiceLabels })
        setQuestionHtml(questionMarkup)
        setExplanationHtml(explanationMarkup)
        // Warm the browser image cache for the current question so the images
        // paint as soon as the HTML is committed, not on a second roundtrip.
        prefetchImagesFromHtml(questionMarkup)
        prefetchImagesFromHtml(explanationMarkup)
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : 'Unable to load question content.')
      })

    return () => {
      cancelled = true
    }
  }, [currentQid, qbankPath, selectedQnum, syncedSelectedQnum])

  // Build a stable, memoized list of neighbor qids to prefetch. Using a joined
  // key keeps the effect below from re-firing on every unrelated rerender
  // (e.g. opening the Notes panel), which would otherwise trigger redundant
  // network calls for already-cached questions.
  const prefetchNeighborKey = useMemo(() => {
    const ids: string[] = []
    for (let offset = -1; offset <= 2; offset += 1) {
      const index = selectedQnum + offset
      if (index < 0 || index >= blockqlist.length || index === selectedQnum) {
        continue
      }
      const qid = blockqlist[index]
      if (qid) {
        ids.push(qid)
      }
    }
    return ids.join('|')
  }, [blockqlist, selectedQnum])

  // Prefetch a small window of adjacent questions so clicking Next/Previous
  // feels instantaneous. Once we have each neighbor's HTML, we also warm up
  // the image URLs it references so figures don't blink in after navigation.
  useEffect(() => {
    if (!qbankPath || !prefetchNeighborKey) {
      return
    }
    let cancelled = false
    const qids = prefetchNeighborKey.split('|').filter(Boolean)
    for (const qid of qids) {
      prefetchQuestionAssets(qbankPath, qid)
      // Also warm images once the HTML is in the cache. Because
      // `fetchQuestionAssets` memoizes by (basePath, qid) in production, this
      // is a no-op on cache hits.
      void fetchQuestionAssets(qbankPath, qid)
        .then(({ questionHtml, explanationHtml }) => {
          if (cancelled) {
            return
          }
          const hint = `${Math.floor(window.innerHeight * 0.4)}px`
          prefetchImagesFromHtml(rewriteAssetPaths(questionHtml, qbankPath, hint))
          prefetchImagesFromHtml(rewriteAssetPaths(explanationHtml, qbankPath, hint))
        })
        .catch(() => {
          // Prefetch failures are non-fatal; the on-demand fetch will retry.
        })
    }
    return () => {
      cancelled = true
    }
  }, [prefetchNeighborKey, qbankPath])

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
    if (!questionHtml) {
      return
    }
    if (selectedQnum !== syncedSelectedQnum) {
      return
    }

    const initialPayload = JSON.stringify(getHighlightDoc(block, selectedQnum).question)
    ownHighlightPayloadRef.current = currentHighlightPayload
    const mountedHighlighter = mountQuestionHighlighter({
      container: questionBodyRef.current,
      color: highlightColor,
      target: 'question',
      serializedHighlights: initialPayload,
      onSerializedChange(serialized) {
        const next = mutateCurrentInfo((draft) => {
          const nextBlock = draft.progress.blockhist[blockKey]!
          nextBlock.questionStates[selectedQnum]!.visited = true
          setHighlightDocTarget(nextBlock, selectedQnum, 'question', parseSerializedHighlightEntries(serialized))
        })
        ownHighlightPayloadRef.current = next?.progress.blockhist[blockKey]?.highlights[selectedQnum] ?? '[]'
        void persistInfo(next, { silent: true })
      }
    })
    questionHighlighterRef.current = mountedHighlighter
    mountedHighlighter.setEnabled(selectedMarker !== 'none')

    return () => {
      mountedHighlighter.destroy()
      questionHighlighterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKey, questionHtml, selectedQnum, syncedSelectedQnum])

  useEffect(() => {
    if (!block || !explanationBodyRef.current || !explanationVisible) {
      return
    }
    if (!explanationHtml) {
      return
    }
    if (selectedQnum !== syncedSelectedQnum) {
      return
    }

    const initialPayload = JSON.stringify(getHighlightDoc(block, selectedQnum).explanation)
    ownHighlightPayloadRef.current = currentHighlightPayload
    const mountedHighlighter = mountQuestionHighlighter({
      container: explanationBodyRef.current,
      color: highlightColor,
      target: 'explanation',
      serializedHighlights: initialPayload,
      onSerializedChange(serialized) {
        const next = mutateCurrentInfo((draft) => {
          const nextBlock = draft.progress.blockhist[blockKey]!
          nextBlock.questionStates[selectedQnum]!.visited = true
          setHighlightDocTarget(nextBlock, selectedQnum, 'explanation', parseSerializedHighlightEntries(serialized))
        })
        ownHighlightPayloadRef.current = next?.progress.blockhist[blockKey]?.highlights[selectedQnum] ?? '[]'
        void persistInfo(next, { silent: true })
      }
    })
    explanationHighlighterRef.current = mountedHighlighter
    mountedHighlighter.setEnabled(selectedMarker !== 'none')

    return () => {
      mountedHighlighter.destroy()
      explanationHighlighterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKey, explanationHtml, explanationVisible, selectedQnum, syncedSelectedQnum])

  useEffect(() => {
    questionHighlighterRef.current?.setColor(highlightColor)
    questionHighlighterRef.current?.setEnabled(selectedMarker !== 'none')
    explanationHighlighterRef.current?.setColor(highlightColor)
    explanationHighlighterRef.current?.setEnabled(selectedMarker !== 'none')
  }, [highlightColor, selectedMarker])

  // Sync external highlight payload changes (e.g. "Clear All Highlights"
  // from the marker menu) into the live engine without destroying it.
  // Self-mutations are tracked via ownHighlightPayloadRef so we skip
  // redundant setEntries calls.
  useEffect(() => {
    if (currentHighlightPayload === ownHighlightPayloadRef.current) {
      return
    }
    ownHighlightPayloadRef.current = currentHighlightPayload
    if (questionHighlighterRef.current) {
      const doc = block ? getHighlightDoc(block, selectedQnum) : { question: [], explanation: [] }
      questionHighlighterRef.current.setEntries(doc.question)
    }
    if (explanationHighlighterRef.current) {
      const doc = block ? getHighlightDoc(block, selectedQnum) : { question: [], explanation: [] }
      explanationHighlighterRef.current.setEntries(doc.explanation)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHighlightPayload])

  const openImageInspector = useCallback((image: HTMLImageElement) => {
    const src = image.getAttribute('src')
    if (!src) {
      return
    }
    const alt = image.getAttribute('alt') ?? ''
    setInspectorItem({
      src,
      alt: alt || 'Question image'
    })
  }, [])

  // Enhance images inside the question stem and explanation so clicking any
  // of them opens the floating image inspector. We use event delegation
  // (capture phase) at the container level so the wiring survives the
  // highlighter remounting the DOM or stamping its own onclick on the image.
  useEffect(() => {
    const containers: Array<HTMLElement | null> = [questionBodyRef.current, explanationBodyRef.current]
    const cleanups: Array<() => void> = []

    function decorateImage(image: HTMLImageElement): void {
      image.classList.add('exam-openable-image')
      image.setAttribute('tabindex', '0')
      image.setAttribute('role', 'button')
      if (!image.getAttribute('aria-label')) {
        image.setAttribute('aria-label', image.getAttribute('alt')?.trim() || 'Open image')
      }
      // Null out any legacy onclick so window.open can't race our inspector.
      image.onclick = null
    }

    for (const container of containers) {
      if (!container) {
        continue
      }
      const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-openable-image="true"]'))
      for (const image of images) {
        decorateImage(image)
      }

      const onClickCapture = (event: Event) => {
        const target = event.target
        if (!(target instanceof HTMLImageElement)) {
          return
        }
        if (target.getAttribute('data-openable-image') !== 'true') {
          return
        }
        // Re-apply decoration defensively in case the highlighter added a new
        // handler between our last render and this click.
        decorateImage(target)
        event.preventDefault()
        event.stopPropagation()
        // Stop immediate propagation too: this guarantees any onclick the
        // highlighter may have attached to the image itself does not run.
        if (typeof (event as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation === 'function') {
          (event as Event & { stopImmediatePropagation: () => void }).stopImmediatePropagation()
        }
        openImageInspector(target)
      }

      const onKeyDownCapture = (event: Event) => {
        const keyboardEvent = event as KeyboardEvent
        const target = event.target
        if (!(target instanceof HTMLImageElement)) {
          return
        }
        if (target.getAttribute('data-openable-image') !== 'true') {
          return
        }
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
          event.preventDefault()
          openImageInspector(target)
        }
      }

      container.addEventListener('click', onClickCapture, true)
      container.addEventListener('keydown', onKeyDownCapture, true)
      cleanups.push(() => {
        container.removeEventListener('click', onClickCapture, true)
        container.removeEventListener('keydown', onKeyDownCapture, true)
      })
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [questionHtml, explanationHtml, openImageInspector])

  useEffect(() => {
    function handleFullscreenChange(): void {
      setFullscreenActive(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    if (!markerMenuOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node | null
      if (markerMenuRef.current?.contains(target) || markerButtonRef.current?.contains(target)) {
        return
      }
      setMarkerMenuOpen(false)
    }

    function handleResize(): void {
      const rect = markerButtonRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      setMarkerMenuPosition({
        top: Math.round(rect.bottom + 6),
        right: Math.max(8, Math.round(window.innerWidth - rect.right))
      })
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [markerMenuOpen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      if (event.key === 'Escape') {
        if (markerMenuOpen) {
          event.preventDefault()
          setMarkerMenuOpen(false)
          return
        }
        if (shortcutWindowOpen) {
          event.preventDefault()
          setShortcutWindowOpen(false)
          return
        }
        if (activeTool) {
          event.preventDefault()
          closeToolPanel()
          return
        }
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (event.altKey && event.code === 'Slash') {
        event.preventDefault()
        toggleShortcutsWindow()
        return
      }

      if ((event.metaKey && event.ctrlKey && key === 'f') || (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === 'F11')) {
        event.preventDefault()
        void toggleFullscreen()
        return
      }

      if (event.altKey && event.code === 'KeyM') {
        event.preventDefault()
        toggleFlaggedQuestion()
        return
      }

      if (event.altKey && event.code === 'KeyN') {
        event.preventDefault()
        openTool('notes')
        return
      }

      if (event.altKey && event.code === 'KeyL') {
        event.preventDefault()
        openTool('lab-values')
        return
      }

      if (event.altKey && event.code === 'KeyC') {
        event.preventDefault()
        openTool('calculator')
        return
      }

      if (event.altKey && event.code === 'Comma') {
        event.preventDefault()
        openTool('settings')
        return
      }

      if (event.altKey && event.code === 'KeyA') {
        event.preventDefault()
        toggleSidebar()
        return
      }

      if (event.altKey && event.key === 'Enter') {
        event.preventDefault()
        void submitCurrentAnswer()
        return
      }

      if (event.altKey && event.code === 'KeyO') {
        event.preventDefault()
        // TODO(topbar-tools): wire Notebook when the footer handler lands.
        return
      }

      if (event.altKey && event.code === 'KeyR') {
        event.preventDefault()
        // TODO(topbar-tools): wire Library when the footer handler lands.
        return
      }

      if (event.altKey && event.code === 'KeyF') {
        event.preventDefault()
        // TODO(topbar-tools): wire Feedback when the footer handler lands.
        return
      }

      if (event.altKey && event.code === 'KeyS') {
        event.preventDefault()
        // TODO(topbar-tools): wire Split View when the feature lands.
        return
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (event.code === 'Backquote') {
          event.preventDefault()
          applyMarker('none')
          return
        }

        if (['1', '2', '3', '4'].includes(event.key)) {
          event.preventDefault()
          applyMarker(MARKER_PRESETS[Number(event.key)]!.key)
          return
        }

        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          openQuestion(selectedQnum - 1)
          return
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault()
          void goToNextQuestionOrFinish()
          return
        }

        const answerChoice = displayChoices.find((choice) => choice.toLowerCase() === key)
        if (answerChoice) {
          event.preventDefault()
          selectAnswer(answerChoice)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeTool, block?.complete, currentAnswer, currentState?.submitted, displayChoices, markerMenuOpen, selectedQnum, shortcutWindowOpen, tutorReviewReady])

  useEffect(() => {
    if (!block || !currentState || currentState.visited) {
      return
    }
    const next = mutateCurrentInfo((draft) => {
      draft.progress.blockhist[blockKey]!.questionStates[selectedQnum]!.visited = true
    })
    void persistInfo(next, { silent: true })
  }, [blockKey, currentState?.visited, selectedQnum])

  useEffect(() => {
    if (scrollToExplanationRef.current && explanationVisible) {
      scrollToExplanationRef.current = false
      document.getElementById('explanationSection')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
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

  useEffect(() => {
    return () => {
      void flushPendingNote({ immediate: true, silent: true, keepalive: true })
    }
  }, [])

  if (loading || !qbankinfo || !block || !currentState) {
    return <div className="d-flex flex-column flex-grow-1 justify-content-center align-items-center"><div className="spinner-border" style={{ width: 72, height: 72 }} role="status" /></div>
  }

  const activeToolTitle = activeTool === 'notes'
    ? 'Question Notes'
    : activeTool === 'lab-values'
      ? 'Lab Values'
      : activeTool === 'calculator'
        ? 'Calculator'
        : 'Settings'
  const activeToolDescription = activeTool === 'notes'
    ? 'Notes save per question in this block.'
    : activeTool === 'lab-values'
      ? 'Standard exam-style reference ranges based on the NBME laboratory values sheet.'
      : activeTool === 'calculator'
        ? 'A native in-block calculator so you can keep the exam workspace on one screen.'
        : 'Adjust reading text and question rail indicators for this exam workspace.'

  return (
    <>
      <ExamShellV2
      mode={examUiMode}
      sidebarCollapsed={!sidebarOpen}
      topbar={(
        <header className="exam-topbar">
          <div className="exam-topbar-left">
            <button className={`exam-topbar-menu ${sidebarOpen ? 'active' : ''}`} type="button" aria-pressed={sidebarOpen} aria-label="Toggle sidebar" onClick={toggleSidebar}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                <line x1="5" y1="7" x2="19" y2="7" />
                <line x1="5" y1="12" x2="19" y2="12" />
                <line x1="5" y1="17" x2="19" y2="17" />
              </svg>
            </button>
            <div className="exam-question-context">
              <span className="context-item">Item {selectedQnum + 1} of {numQuestions}</span>
              <span className="context-id">Question Id: {currentQid}</span>
            </div>
            <button
              id="btn-flagged"
              className={`exam-topbar-action exam-topbar-action-mark ${currentQuestionFlagged ? 'active' : ''}`}
              type="button"
              aria-pressed={currentQuestionFlagged}
              onClick={toggleFlaggedQuestion}
            >
              <svg className="flag-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path className="flag-pole" d="M5 3v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path className="flag-fill" d="M6.8 4.2H18.3V12.9H6.8z" />
              </svg>
              <span>Mark</span>
            </button>
          </div>

          <div className="exam-topbar-center">
            <button
              className="exam-topbar-nav"
              type="button"
              disabled={selectedQnum === 0}
              onClick={() => openQuestion(selectedQnum - 1)}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 5 6 12l10.5 7z" /></svg>
              <span>Previous</span>
            </button>
            <button
              className="exam-topbar-nav"
              type="button"
              onClick={() => void goToNextQuestionOrFinish()}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m7.5 5 10.5 7-10.5 7z" /></svg>
              <span>{selectedQnum === numQuestions - 1 ? (block.complete ? 'Back' : 'Finish') : 'Next'}</span>
            </button>
          </div>

          <div className="exam-topbar-right">
            <button
              className={`exam-topbar-tool ${shortcutWindowOpen ? 'active' : ''}`}
              type="button"
              aria-pressed={shortcutWindowOpen}
              onClick={toggleShortcutsWindow}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
              </svg>
              <span>Shortcuts</span>
            </button>
            <button
              className={`exam-topbar-tool ${fullscreenActive ? 'active' : ''}`}
              type="button"
              aria-pressed={fullscreenActive}
              onClick={() => void toggleFullscreen()}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4" />
              </svg>
              <span>Full Screen</span>
            </button>
            <button
              ref={markerButtonRef}
              className={`exam-topbar-tool ${markerMenuOpen ? 'active' : ''}`}
              type="button"
              aria-haspopup="menu"
              aria-expanded={markerMenuOpen}
              onClick={toggleMarkerMenu}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 11-6 6v3h3l6-6" />
                <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
              </svg>
              <span>Marker</span>
            </button>
            <button
              className={`exam-topbar-tool ${activeTool === 'lab-values' ? 'active' : ''}`}
              type="button"
              aria-expanded={activeTool === 'lab-values'}
              onClick={() => toggleTool('lab-values')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3h6" />
                <path d="M10 3v6l-5 8a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-8V3" />
                <path d="M7.5 14h9" />
              </svg>
              <span>Lab Values</span>
            </button>
            <button
              className={`exam-topbar-tool ${activeTool === 'notes' ? 'active' : ''}`}
              type="button"
              aria-expanded={activeTool === 'notes'}
              onClick={() => toggleTool('notes')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="8" y="2" width="8" height="4" rx="1" />
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              </svg>
              <span>Notes</span>
            </button>
            <button
              className={`exam-topbar-tool ${activeTool === 'calculator' ? 'active' : ''}`}
              type="button"
              aria-expanded={activeTool === 'calculator'}
              onClick={() => toggleTool('calculator')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <path d="M8 6h8" />
                <path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
              </svg>
              <span>Calculator</span>
            </button>
            <button
              className={`exam-topbar-tool ${activeTool === 'settings' ? 'active' : ''}`}
              type="button"
              aria-expanded={activeTool === 'settings'}
              onClick={() => toggleTool('settings')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Settings</span>
            </button>
          </div>
        </header>
      )}
      rail={(
        <aside className={`exam-sidebar ${sidebarOpen ? '' : 'exam-sidebar-hidden'}`}>
          <div className="exam-question-list">
            <ul className="list-group">
              {questionRail.map((entry) => (
                <li
                  key={entry.qid + entry.index}
                  className={entry.classes}
                  onClick={() => openQuestion(entry.index)}
                >
                  {block.complete || (block.mode === 'tutor' && entry.state?.revealed) ? (
                    <span className={`q-status-dot ${entry.state?.correct ? 'correct' : 'incorrect'}`} aria-hidden="true">
                      {entry.state?.correct ? (
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                        </svg>
                      )}
                    </span>
                  ) : null}
                  <span className="q-item-number">{entry.index + 1}</span>
                  {entry.flagged ? (
                    <span className="q-flag-dot" aria-hidden="true">
                      <svg width="11" height="13" viewBox="0 0 12 14" aria-hidden="true">
                        <path d="M2 1 H10 V5.5 H2 Z" fill="currentColor" />
                        <line x1="2" y1="1" x2="2" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </span>
                  ) : null}
                  {uiPrefs.showUnsubmittedIndicator && !entry.flagged && !entry.state?.submitted && entry.index !== selectedQnum ? <span className="q-unsubmitted-dot" aria-hidden="true" /> : null}
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
              <div ref={questionBodyRef} className="exam-question-body exam-reading-scale" dangerouslySetInnerHTML={{ __html: questionHtml }} />
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
              <div className="exam-choices-container exam-reading-scale">
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
                          onClick={() => selectAnswer(choice)}
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
                    onClick={() => void submitCurrentAnswer()}
                  >
                    {currentState.submitted ? 'Answer Submitted' : 'Submit Answer'}
                  </button>
                ) : null}

                {showBottomNextButton ? (
                  <button
                    className="btn btn-secondary btn-nextques"
                    type="button"
                    onClick={() => void goToBottomNextAction()}
                  >
                    {selectedQnum === numQuestions - 1 ? (block.complete ? 'Back to Blocks' : (block.mode === 'tutor' ? 'Finish Review' : 'End Block')) : 'Next Question'}
                  </button>
                ) : null}
              </div>
            </section>

            <section id="explanationSection" className={`exam-section exam-explanation-section ${explanationVisible ? '' : 'exam-hidden'}`}>
              <div className="exam-explanation-header">
                {explanationVisible ? (() => {
                  const correctChoice = qbankinfo.choices[currentQid]?.correct ?? ''
                  const isCorrect = currentAnswer !== '' && currentAnswer === correctChoice
                  return (
                    <div className={`exam-result-pill ${isCorrect ? 'exam-result-pill-correct' : 'exam-result-pill-incorrect'}`} role="status" aria-live="polite">
                      <span className="exam-result-pill-status">{isCorrect ? 'Correct' : 'Incorrect'}</span>
                      {correctChoice ? (
                        <>
                          <span className="exam-result-pill-divider" aria-hidden="true" />
                          <span className="exam-result-pill-answer-label">{isCorrect ? 'Answer' : 'Correct answer'}</span>
                          <span className="exam-result-pill-answer">{correctChoice}</span>
                        </>
                      ) : null}
                    </div>
                  )
                })() : (
                  <p className="exam-panel-note exam-explanation-empty-note mb-0">
                    {block.mode === 'tutor' ? 'Submit the current question to reveal the explanation.' : 'Explanation hidden until you end the block and enter review mode.'}
                  </p>
                )}
                {sourceSlideAsset ? (
                  <button className="btn btn-outline-secondary btn-sm exam-explanation-source-btn" type="button" onClick={() => setSourceSlideOpen(true)}>
                    Source Slide
                  </button>
                ) : null}
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
              <div ref={explanationBodyRef} className="exam-explanation-body exam-reading-scale" dangerouslySetInnerHTML={{ __html: explanationHtml }} />
            </section>
          </div>
        </section>
      )}
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
                  await flushPendingNote({ immediate: true, silent: true })
                  commitRunningElapsed()
                  const next = mutateCurrentInfo((draft) => {
                    draft.progress.blockhist[blockKey]!.currentquesnum = selectedQnum
                    draft.progress.blockhist[blockKey]!.questionStates[selectedQnum]!.visited = true
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
      {activeTool ? <button className="exam-v2-tool-scrim" type="button" aria-label="Close tool panel" onClick={closeToolPanel} /> : null}
      {activeTool ? (
        <aside className={`exam-v2-tool-sheet ${activeTool === 'lab-values' ? 'exam-v2-tool-sheet-wide' : ''}`} aria-label={`${activeToolTitle} Panel`}>
          <div className="exam-v2-tool-head">
            <div>
              <p className="exam-v2-tool-title">{activeToolTitle}</p>
              <p className="exam-v2-tool-copy">{activeToolDescription}</p>
            </div>
            <button className="exam-v2-tool-close" type="button" onClick={closeToolPanel}>
              Close
            </button>
          </div>

          {activeTool === 'notes' ? (
            <textarea
              aria-label="Question Notes"
              className="exam-v2-note-input"
              placeholder="Add your note for this question..."
              value={noteText}
              onChange={(event) => {
                const value = event.target.value
                setNoteText(value)
                scheduleNotePersist(selectedQnum, value)
              }}
              onBlur={() => {
                void flushPendingNote({ immediate: true, silent: true })
              }}
            />
          ) : null}

          {activeTool === 'calculator' ? (
            <div className="exam-v2-calculator">
              <div className="q-metric-box exam-v2-calc-readout">
                <p className="q-metric-label mb-2">Current Result</p>
                <input aria-label="Calculator Display" className="q-input exam-v2-calc-display" readOnly value={calculatorDisplay} />
                <p className="exam-v2-calc-history mb-0" aria-live="polite">{calculatorHistory}</p>
              </div>
              <div className="exam-v2-calc-grid" role="group" aria-label="Calculator keypad">
                <button className="exam-v2-calc-btn exam-v2-calc-btn-utility" type="button" onClick={resetCalculator}>AC</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-utility" type="button" onClick={toggleCalculatorSign}>+/-</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-utility" type="button" onClick={applyCalculatorPercent}>%</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-operator" type="button" onClick={() => commitCalculatorOperation('divide')}>/</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('7')}>7</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('8')}>8</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('9')}>9</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-operator" type="button" onClick={() => commitCalculatorOperation('multiply')}>x</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('4')}>4</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('5')}>5</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('6')}>6</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-operator" type="button" onClick={() => commitCalculatorOperation('subtract')}>-</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('1')}>1</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('2')}>2</button>
                <button className="exam-v2-calc-btn" type="button" onClick={() => inputCalculatorDigit('3')}>3</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-operator" type="button" onClick={() => commitCalculatorOperation('add')}>+</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-zero" type="button" onClick={() => inputCalculatorDigit('0')}>0</button>
                <button className="exam-v2-calc-btn" type="button" onClick={inputCalculatorDecimal}>.</button>
                <button className="exam-v2-calc-btn exam-v2-calc-btn-equals" type="button" onClick={() => commitCalculatorOperation(null)}>=</button>
              </div>
            </div>
          ) : null}

          {activeTool === 'lab-values' ? (
            <div className="exam-v2-labs">
              <input
                aria-label="Search lab values"
                className="q-input exam-v2-tool-search"
                placeholder="Search lab values or abbreviations..."
                value={labSearchTerm}
                onChange={(event) => setLabSearchTerm(event.target.value)}
              />
              {filteredLabSections.length > 0 ? (
                <div className="exam-v2-labs-list">
                  {filteredLabSections.map((section) => (
                    <section key={section.id} className="q-panel exam-v2-labs-section">
                      <div className="q-panel-header">
                        <div>
                          <p className="q-panel-title">{section.title}</p>
                          <p className="q-panel-subtitle">{section.subtitle}</p>
                        </div>
                      </div>
                      <div className="q-panel-body q-table-wrap exam-v2-labs-table">
                        <div className="table-responsive">
                          <table className="table table-sm">
                            <thead>
                              <tr>
                                <th scope="col">Test</th>
                                <th scope="col">Reference</th>
                                <th scope="col">SI</th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.rows.map((row) => (
                                <tr key={row.label}>
                                  <th scope="row">{row.label}</th>
                                  <td>{row.conventional}</td>
                                  <td>{row.si}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="q-metric-box exam-v2-empty-state">
                  <p className="q-metric-label mb-2">No Match</p>
                  <p className="mb-0">Try a broader search like `sodium`, `cbc`, `bun`, or `coag`.</p>
                </div>
              )}
            </div>
          ) : null}

          {activeTool === 'settings' ? (
            <div className="exam-v2-settings">
              <section className="exam-v2-settings-row">
                <div className="exam-v2-settings-label-wrap">
                  <p className="exam-v2-settings-label">Font size</p>
                  <p className="exam-v2-settings-value">{Math.round(uiPrefs.fontSizeScale * 100)}%</p>
                </div>
                <div className="exam-v2-settings-controls">
                  <button
                    type="button"
                    className="exam-v2-settings-btn"
                    aria-label="Decrease font size"
                    disabled={uiPrefs.fontSizeScale <= FONT_SIZE_MIN + 1e-6}
                    onClick={() => updateUiPrefs({ fontSizeScale: normalizeFontSizeScale(uiPrefs.fontSizeScale - FONT_SIZE_STEP) })}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="exam-v2-settings-btn"
                    aria-label="Increase font size"
                    disabled={uiPrefs.fontSizeScale >= FONT_SIZE_MAX - 1e-6}
                    onClick={() => updateUiPrefs({ fontSizeScale: normalizeFontSizeScale(uiPrefs.fontSizeScale + FONT_SIZE_STEP) })}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="exam-v2-settings-btn exam-v2-settings-btn-reset"
                    onClick={() => updateUiPrefs({ fontSizeScale: DEFAULT_UI_PREFS.fontSizeScale })}
                  >
                    Reset
                  </button>
                </div>
              </section>

              <section className="exam-v2-settings-row">
                <div className="exam-v2-settings-label-wrap">
                  <p className="exam-v2-settings-label">Font weight</p>
                  <p className="exam-v2-settings-value">
                    {uiPrefs.fontWeightDelta === 0 ? 'Normal' : (uiPrefs.fontWeightDelta > 0 ? `Heavier +${uiPrefs.fontWeightDelta}` : `Lighter ${uiPrefs.fontWeightDelta}`)}
                  </p>
                </div>
                <div className="exam-v2-settings-controls">
                  <button
                    type="button"
                    className="exam-v2-settings-btn"
                    aria-label="Decrease font weight"
                    disabled={uiPrefs.fontWeightDelta <= FONT_WEIGHT_MIN}
                    onClick={() => updateUiPrefs({ fontWeightDelta: normalizeFontWeightDelta(uiPrefs.fontWeightDelta - FONT_WEIGHT_STEP) })}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="exam-v2-settings-btn"
                    aria-label="Increase font weight"
                    disabled={uiPrefs.fontWeightDelta >= FONT_WEIGHT_MAX}
                    onClick={() => updateUiPrefs({ fontWeightDelta: normalizeFontWeightDelta(uiPrefs.fontWeightDelta + FONT_WEIGHT_STEP) })}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="exam-v2-settings-btn exam-v2-settings-btn-reset"
                    onClick={() => updateUiPrefs({ fontWeightDelta: DEFAULT_UI_PREFS.fontWeightDelta })}
                  >
                    Reset
                  </button>
                </div>
              </section>

              <section className="exam-v2-settings-row exam-v2-settings-row-stack">
                <p className="exam-v2-settings-label">Theme</p>
                <div className="exam-v2-settings-theme">
                  <label className={`exam-v2-settings-theme-option ${uiPrefs.theme === 'light' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="exam-v2-theme"
                      value="light"
                      checked={uiPrefs.theme === 'light'}
                      onChange={() => updateUiPrefs({ theme: 'light' })}
                    />
                    <span>Light</span>
                  </label>
                  <label className={`exam-v2-settings-theme-option ${uiPrefs.theme === 'dark' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="exam-v2-theme"
                      value="dark"
                      checked={uiPrefs.theme === 'dark'}
                      onChange={() => updateUiPrefs({ theme: 'dark' })}
                    />
                    <span>Dark</span>
                  </label>
                </div>
              </section>

              <section className="exam-v2-settings-row">
                <div className="exam-v2-settings-label-wrap">
                  <p className="exam-v2-settings-label">Show unsubmitted question indicator</p>
                  <p className="exam-v2-settings-hint">
                    Blue dot in the left rail for questions you haven't submitted yet.
                  </p>
                </div>
                <label className="exam-v2-settings-switch">
                  <input
                    type="checkbox"
                    checked={uiPrefs.showUnsubmittedIndicator}
                    onChange={(event) => updateUiPrefs({ showUnsubmittedIndicator: event.target.checked })}
                  />
                  <span className="exam-v2-settings-switch-slider" aria-hidden="true" />
                </label>
              </section>

              <div className="exam-v2-settings-footer">
                <button
                  type="button"
                  className="exam-v2-tool-action"
                  onClick={resetUiPrefs}
                >
                  Reset all settings
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
      <FloatingWindow
        open={shortcutWindowOpen}
        onClose={() => setShortcutWindowOpen(false)}
        title="Keyboard Shortcuts"
        titleId="exam-shortcuts-title"
        className="exam-shortcuts-window"
      >
        <div className="exam-shortcuts-platforms" role="tablist" aria-label="Shortcut platform">
          <button className={`exam-shortcuts-platform ${shortcutPlatform === 'windows' ? 'active' : ''}`} type="button" role="tab" aria-selected={shortcutPlatform === 'windows'} onClick={() => setShortcutPlatform('windows')}>Windows</button>
          <button className={`exam-shortcuts-platform ${shortcutPlatform === 'mac' ? 'active' : ''}`} type="button" role="tab" aria-selected={shortcutPlatform === 'mac'} onClick={() => setShortcutPlatform('mac')}>macOS</button>
        </div>
        <div className="exam-shortcuts-grid">
          {SHORTCUT_DEFINITIONS.map((definition) => {
            const keys = shortcutPlatform === 'mac' ? definition.macKeys : definition.windowsKeys
            return (
              <div key={definition.action} className="exam-shortcuts-card">
                <div className="exam-shortcuts-keys">
                  {keys.map((shortcutKey, index) => (
                    <span key={`${definition.action}-${shortcutKey}-${index}`} className="exam-shortcuts-keygroup">
                      {index > 0 ? <span className="exam-shortcuts-plus">{keys.length === 4 ? ',' : '+'}</span> : null}
                      <span className="exam-shortcuts-key">{shortcutKey}</span>
                    </span>
                  ))}
                </div>
                <span className="exam-shortcuts-arrow">→</span>
                <span className="exam-shortcuts-action">{definition.action}</span>
              </div>
            )
          })}
        </div>
      </FloatingWindow>
      {markerMenuOpen ? (
        <div
          ref={markerMenuRef}
          className="exam-marker-menu"
          role="menu"
          aria-label="Marker colors"
          style={{ top: markerMenuPosition.top, right: markerMenuPosition.right }}
        >
          <ul className="exam-marker-menu-list" role="presentation">
            {MARKER_PRESETS.map((preset) => (
              <li key={preset.key} role="presentation">
                <button
                  role="menuitemradio"
                  aria-checked={selectedMarker === preset.key}
                  className={`exam-marker-menu-item ${selectedMarker === preset.key ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    applyMarker(preset.key)
                    setMarkerMenuOpen(false)
                  }}
                >
                  <span className="exam-marker-menu-icon" style={{ color: preset.accent }} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M14.6 3.2 20.8 9.4l-8.9 8.9-3.7.9.9-3.7zM5.3 16.7 3 21l4.3-2.3z" />
                    </svg>
                  </span>
                  <span className="exam-marker-menu-label">{preset.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="exam-marker-menu-action" onClick={() => setMarkerMenuOpen(false)}>Create</button>
          <button
            type="button"
            className="exam-marker-menu-action"
            onClick={() => {
              clearAllHighlights()
              setMarkerMenuOpen(false)
            }}
          >
            Clear All
          </button>
        </div>
      ) : null}
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
      <ImageInspector open={Boolean(inspectorItem)} item={inspectorItem} onClose={() => setInspectorItem(null)} />
      <SyncStatusPill />
    </>
  )
}
