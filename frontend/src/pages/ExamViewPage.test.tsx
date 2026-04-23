import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQbankInfoFixture } from '../test/fixtures'
import { ExamViewPage } from './ExamViewPage'

const api = vi.hoisted(() => ({
  syncProgress: vi.fn()
}))

const navigation = vi.hoisted(() => ({
  navigate: vi.fn()
}))

const packHook = vi.hoisted(() => ({
  usePackPage: vi.fn()
}))

const htmlHelpers = vi.hoisted(() => ({
  fetchQuestionAssets: vi.fn(),
  extractChoiceLabels: vi.fn(),
  rewriteAssetPaths: vi.fn((html: string) => html),
  stripChoicesFromQuestionDisplay: vi.fn((html: string) => html),
  prefetchQuestionAssets: vi.fn(),
  prefetchImagesFromHtml: vi.fn()
}))

const highlighting = vi.hoisted(() => {
  const state: { lastOptions: { onSerializedChange: (serialized: string) => void } | null } = {
    lastOptions: null
  }

  return {
    state,
    mountQuestionHighlighter: vi.fn((options) => {
      state.lastOptions = options
      return {
        setColor: vi.fn(),
        setEnabled: vi.fn(),
        clearAll: vi.fn(),
        destroy: vi.fn()
      }
    })
  }
})

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api')
  return { ...(actual as object), ...api }
})
vi.mock('../lib/navigation', () => navigation)
vi.mock('../lib/usePackPage', () => packHook)
vi.mock('../lib/qbank-html', () => htmlHelpers)
vi.mock('../lib/text-highlighting', () => ({ mountQuestionHighlighter: highlighting.mountQuestionHighlighter }))

describe('ExamViewPage', () => {
  let fixture = createQbankInfoFixture()

  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    highlighting.state.lastOptions = null
    window.history.replaceState({}, '', '/examview?pack=pack-1&block=0')
    fixture = createQbankInfoFixture()
    packHook.usePackPage.mockImplementation(() => {
      const [qbankinfo, setQbankinfo] = useState(fixture)
      return {
        loading: false,
        user: null,
        packId: 'pack-1',
        qbankinfo,
        error: '',
        setQbankinfo
      }
    })
    api.syncProgress.mockResolvedValue({ revision: 4 })
    htmlHelpers.fetchQuestionAssets.mockResolvedValue({
      questionHtml: '<div>Question stem</div>',
      explanationHtml: '<div>Explanation body</div>'
    })
    htmlHelpers.extractChoiceLabels.mockReturnValue({
      A: 'Alpha',
      B: 'Bravo',
      C: 'Charlie'
    })
  })

  it('reveals the explanation after tutor submission', async () => {
    const { container } = render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Select answer A' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit Answer' }))

    // The explanation section now shows a result pill instead of a text
    // label — assert on the pill so the test verifies the user-visible state.
    await waitFor(() => {
      expect(container.querySelector('.exam-result-pill')).not.toBeNull()
    })
    expect(container.querySelector('#explanationSection')?.className.includes('exam-hidden')).toBe(false)
  })

  it('persists question notes through the synced local-first flow', async () => {
    window.history.replaceState({}, '', '/examview?pack=pack-1&block=0')
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(screen.queryByPlaceholderText('Add your note for this question...')).not.toBeInTheDocument()
    // Capture the fetch count after the initial pack load (which includes
    // neighbor prefetches). Interactions on the current question should not
    // add to this count.
    const baselineCalls = htmlHelpers.fetchQuestionAssets.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    const textarea = screen.getByLabelText('Question Notes')
    await userEvent.type(textarea, 'Persistent note')
    await userEvent.tab()

    expect(api.syncProgress).toHaveBeenCalled()
    expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalledTimes(baselineCalls)
  })

  it('keeps notes hidden by default and toggles them on demand', async () => {
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(screen.queryByPlaceholderText('Add your note for this question...')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByPlaceholderText('Add your note for this question...')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByPlaceholderText('Add your note for this question...')).not.toBeInTheDocument()
  })

  it('opens restored top-bar tool panels and the shortcuts window', async () => {
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Lab Values' }))
    expect(screen.getByLabelText('Search lab values')).toBeInTheDocument()
    expect(screen.getByText('Sodium (Na+)')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))
    expect(screen.getByLabelText('Calculator Display')).toHaveValue('0')
    await userEvent.click(screen.getByRole('button', { name: '7' }))
    await userEvent.click(screen.getByRole('button', { name: '+' }))
    await userEvent.click(screen.getByRole('button', { name: '8' }))
    await userEvent.click(screen.getByRole('button', { name: '=' }))
    expect(screen.getByLabelText('Calculator Display')).toHaveValue('15')

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('Font size')).toBeInTheDocument()
    expect(screen.getByText('Theme')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Shortcuts' }))
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Windows' })).toBeInTheDocument()
    expect(screen.getByText('Highlight Marker - Yellow')).toBeInTheDocument()
    expect(screen.getByText('Notebook')).toBeInTheDocument()
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('Feedback')).toBeInTheDocument()
    expect(screen.getByText('Split View')).toBeInTheDocument()
  })

  it('drives exam actions from keyboard shortcuts', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen
    })

    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    fireEvent.keyDown(window, { altKey: true, code: 'KeyN', key: 'n' })
    expect(screen.getByLabelText('Question Notes')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('Question Notes')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { altKey: true, code: 'KeyL', key: 'l' })
    expect(screen.getByLabelText('Search lab values')).toBeInTheDocument()

    fireEvent.keyDown(window, { altKey: true, code: 'KeyC', key: 'c' })
    expect(screen.getByLabelText('Calculator Display')).toHaveValue('0')

    fireEvent.keyDown(window, { key: 'b', code: 'KeyB' })
    fireEvent.keyDown(window, { altKey: true, key: 'Enter', code: 'Enter' })
    await waitFor(() => {
      expect(document.querySelector('.exam-result-pill')).not.toBeNull()
    })

    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(await screen.findByText('Item 2 of 2')).toBeInTheDocument()

    fireEvent.keyDown(window, { metaKey: true, ctrlKey: true, key: 'f', code: 'KeyF' })
    expect(requestFullscreen).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { altKey: true, code: 'Comma', key: ',' })
    expect(screen.getByText('Font size')).toBeInTheDocument()
    expect(screen.getByText('Show unsubmitted question indicator')).toBeInTheDocument()

    fireEvent.keyDown(window, { altKey: true, code: 'Slash', key: '/' })
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '2', code: 'Digit2' })
    await userEvent.click(screen.getByRole('button', { name: /Marker/i }))
    expect(screen.getByRole('menu', { name: 'Marker colors' })).toBeInTheDocument()
    const greenItem = screen.getByRole('menuitemradio', { name: /Green/i })
    expect(greenItem).toHaveClass('active')
    expect(greenItem).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Marker colors' })).not.toBeInTheDocument()
  })

  it('prefers question metadata for choice labels and exposes source slide access', async () => {
    fixture = createQbankInfoFixture()
    fixture.progress.blockhist['0']!.currentquesnum = 0

    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(screen.getAllByRole('button', { name: 'Source Slide' })).toHaveLength(2)
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })

  it('shows active flag state and rail markers', async () => {
    const { container } = render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    const flagButton = screen.getByRole('button', { name: 'Mark' })
    expect(flagButton).toHaveAttribute('aria-pressed', 'true')
    expect(flagButton).toHaveClass('active')
    expect(container.querySelectorAll('.q-flag-dot')).toHaveLength(1)
    expect(container.querySelector('.q-flag-dot svg')).not.toBeNull()

    await userEvent.click(flagButton)

    expect(flagButton).toHaveAttribute('aria-pressed', 'false')
    expect(flagButton).not.toHaveClass('active')
    expect(container.querySelectorAll('.q-flag-dot')).toHaveLength(0)
  })

  it('hides the next question button until tutor-mode submission', async () => {
    const { container } = render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(container.querySelector('.btn-nextques')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Select answer B' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit Answer' }))

    await waitFor(() => {
      expect(container.querySelector('.btn-nextques')).not.toBeNull()
    })
  })

  it('does not refetch question assets for same-question interactions', async () => {
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    // After the initial load + neighbor prefetch settles, no same-question
    // interaction should re-issue a fetch for the current question's HTML.
    const baselineCalls = htmlHelpers.fetchQuestionAssets.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: 'Mark' }))
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    const textarea = screen.getByLabelText('Question Notes')
    await userEvent.type(textarea, 'abc')
    await userEvent.tab()

    expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalledTimes(baselineCalls)
  })

  it('keeps the highlighter mounted while saving multiple highlight payloads', async () => {
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(highlighting.mountQuestionHighlighter).toHaveBeenCalledTimes(1)
    })

    api.syncProgress.mockClear()

    highlighting.state.lastOptions!.onSerializedChange('[["wrapper","Question","0",0,8]]')
    await waitFor(() => {
      expect(api.syncProgress).toHaveBeenCalledTimes(1)
    })

    highlighting.state.lastOptions!.onSerializedChange('[["wrapper","Question","0",0,8],["wrapper","stem","0",9,4]]')
    await waitFor(() => {
      expect(api.syncProgress).toHaveBeenCalledTimes(2)
    })

    expect(highlighting.mountQuestionHighlighter).toHaveBeenCalledTimes(1)
  })

  it('renders rail states for current, flagged, correct, incorrect, visited, and unsubmitted questions', async () => {
    fixture = createQbankInfoFixture()
    fixture.progress.blockhist['0']!.blockqlist = ['101', '102', '103']
    fixture.progress.blockhist['0']!.answers = ['B', 'B', '']
    fixture.progress.blockhist['0']!.highlights = ['[]', '[]', '[]']
    fixture.progress.blockhist['0']!.notes = ['', '', '']
    fixture.progress.blockhist['0']!.questionStates = [
      { submitted: true, revealed: true, correct: true, visited: true, eliminatedChoices: [] },
      { submitted: true, revealed: true, correct: false, visited: true, eliminatedChoices: [] },
      { submitted: false, revealed: false, correct: false, visited: false, eliminatedChoices: [] }
    ]
    fixture.progress.blockhist['0']!.currentquesnum = 1
    fixture.progress.tagbuckets.System!.Cardiology!.flagged = ['102']
    fixture.progress.tagbuckets.Topic!.Electrophysiology!.flagged = ['102']

    const { container } = render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    const items = container.querySelectorAll('.exam-question-list .list-group-item')
    expect(items[0]?.className).toContain('q-item-correct')
    expect(items[0]?.className).toContain('q-item-visited')
    expect(items[0]?.querySelector('.q-status-dot svg')).not.toBeNull()
    expect(items[1]?.className).toContain('active')
    expect(items[1]?.className).toContain('q-item-incorrect')
    expect(items[1]?.querySelector('.q-status-dot svg')).not.toBeNull()
    expect(items[1]?.querySelector('.q-flag-dot svg')).not.toBeNull()
    expect(items[2]?.className).toContain('q-item-unopened')
    expect(items[2]?.querySelector('.q-unsubmitted-dot')).not.toBeNull()
  })

  it('hides the unsubmitted dot when the setting is toggled off', async () => {
    window.localStorage.setItem('quail-live:store:exam:ui-prefs', JSON.stringify({
      fontSizeScale: 1,
      fontWeightDelta: 0,
      theme: 'light',
      showUnsubmittedIndicator: false
    }))

    fixture = createQbankInfoFixture()
    fixture.progress.blockhist['0']!.blockqlist = ['101', '102']
    fixture.progress.blockhist['0']!.answers = ['', '']
    fixture.progress.blockhist['0']!.highlights = ['[]', '[]']
    fixture.progress.blockhist['0']!.notes = ['', '']
    fixture.progress.blockhist['0']!.questionStates = [
      { submitted: false, revealed: false, correct: false, visited: false, eliminatedChoices: [] },
      { submitted: false, revealed: false, correct: false, visited: false, eliminatedChoices: [] }
    ]

    const { container } = render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(container.querySelector('.q-unsubmitted-dot')).toBeNull()

    window.localStorage.removeItem('quail-live:store:exam:ui-prefs')
  })
})
