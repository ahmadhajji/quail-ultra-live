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

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api')
  return { ...(actual as object), ...api }
})
vi.mock('../lib/navigation', () => navigation)
vi.mock('../lib/usePackPage', () => packHook)
vi.mock('../lib/qbank-html', () => htmlHelpers)

describe('ExamViewPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/examview.html?pack=pack-1&block=0')
    const fixture = createQbankInfoFixture()
    packHook.usePackPage.mockReturnValue({
      loading: false,
      user: null,
      packId: 'pack-1',
      qbankinfo: fixture,
      error: '',
      setQbankinfo: vi.fn()
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
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    await userEvent.click(screen.getByRole('button', { name: /alpha/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit Answer' }))

    expect(await screen.findByText('Explanation')).toBeInTheDocument()
  })

  it('persists question notes through the synced local-first flow', async () => {
    window.history.replaceState({}, '', '/examview.html?pack=pack-1&block=0&ui=v2')
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    await userEvent.type(screen.getAllByLabelText('Question Notes')[0]!, 'Persistent note')

    expect(api.syncProgress).toHaveBeenCalled()
  })

  it('keeps the legacy exam layout free of the v2 drawer by default', async () => {
    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(screen.queryByPlaceholderText('Add your note for this question...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reference' })).toBeInTheDocument()
  })

  it('prefers question metadata for choice labels and exposes source slide access', async () => {
    const fixture = createQbankInfoFixture()
    fixture.progress.blockhist['0']!.currentquesnum = 0
    packHook.usePackPage.mockReturnValue({
      loading: false,
      user: null,
      packId: 'pack-1',
      qbankinfo: fixture,
      error: '',
      setQbankinfo: vi.fn()
    })

    render(<ExamViewPage />)

    await waitFor(() => {
      expect(htmlHelpers.fetchQuestionAssets).toHaveBeenCalled()
    })

    expect(screen.getAllByRole('button', { name: 'Source Slide' })).toHaveLength(2)
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })
})
