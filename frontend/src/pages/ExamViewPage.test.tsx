import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    vi.clearAllMocks()
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
})
