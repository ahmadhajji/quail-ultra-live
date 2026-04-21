import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  stripChoicesFromQuestionDisplay: vi.fn((html: string) => html)
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

    expect(await screen.findByText('Explanation')).toBeInTheDocument()
    expect(container.querySelector('#explanationSection')?.className.includes('exam-hidden')).toBe(false)
  })

  it('persists question notes through the synced local-first flow', async () => {
    window.history.replaceState({}, '', '/examview?pack=pack-1&block=0')
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(screen.queryByPlaceholderText('Add your note for this question...')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    const textarea = screen.getByLabelText('Question Notes')
    await userEvent.type(textarea, 'Persistent note')
    await userEvent.tab()

    expect(api.syncProgress).toHaveBeenCalled()
    expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalledTimes(1)
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

    const flagButton = screen.getByRole('button', { name: 'Flag' })
    expect(flagButton).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('.q-flag-dot')).toHaveLength(1)

    await userEvent.click(flagButton)

    expect(flagButton).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelectorAll('.q-flag-dot')).toHaveLength(0)
  })

  it('does not refetch question assets for same-question interactions', async () => {
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalledTimes(1)
    })

    await userEvent.click(screen.getByRole('button', { name: 'Flag' }))
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    const textarea = screen.getByLabelText('Question Notes')
    await userEvent.type(textarea, 'abc')
    await userEvent.tab()

    expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalledTimes(1)
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

  it('renders rail states for current, flagged, correct, incorrect, visited, and unopened questions', async () => {
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
    expect(items[1]?.className).toContain('active')
    expect(items[1]?.className).toContain('q-item-incorrect')
    expect(items[1]?.querySelector('.q-flag-dot')).not.toBeNull()
    expect(items[2]?.className).toContain('q-item-unopened')
  })
})
