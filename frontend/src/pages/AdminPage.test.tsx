import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from './AdminPage'

const api = vi.hoisted(() => ({
  createAdminUser: vi.fn(),
  createInvite: vi.fn(),
  deprecateNativePackQuestion: vi.fn(),
  deleteAdminPack: vi.fn(),
  deleteAdminUser: vi.fn(),
  deleteLibraryPack: vi.fn(),
  getAdminPackProgressSummary: vi.fn(),
  getAppSettings: vi.fn(),
  getNativePackContent: vi.fn(),
  getNativePackQuestion: vi.fn(),
  getSession: vi.fn(),
  listAdminUsers: vi.fn(),
  listInvites: vi.fn(),
  listLibraryPacks: vi.fn(),
  listQuestionReports: vi.fn(),
  listSupportTickets: vi.fn(),
  listUserPacks: vi.fn(),
  promoteToLibrary: vi.fn(),
  publishNativePackRevision: vi.fn(),
  resetAdminPack: vi.fn(),
  revokeInvite: vi.fn(),
  updateAdminUser: vi.fn(),
  updateAppSettings: vi.fn(),
  updateNativePackQuestion: vi.fn(),
  validateNativePackRevision: vi.fn()
}))

const navigation = vi.hoisted(() => ({
  navigate: vi.fn()
}))

vi.mock('../lib/api', () => api)
vi.mock('../lib/navigation', () => navigation)

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getSession.mockResolvedValue({ id: 'admin-1', username: 'admin', email: '', role: 'admin', status: 'active', createdAt: 'now' })
    api.getAppSettings.mockResolvedValue({ registrationMode: 'invite-only' })
    api.listAdminUsers.mockResolvedValue([{ id: 'admin-1', username: 'admin', email: '', role: 'admin', status: 'active', createdAt: 'now', updatedAt: 'now', packCount: 1 }])
    api.listInvites.mockResolvedValue([])
    api.listLibraryPacks.mockResolvedValue([{ id: 'system-1', name: 'Pediatrics', description: '', questionCount: 2, createdAt: 'now', updatedAt: 'now' }])
    api.listQuestionReports.mockResolvedValue([])
    api.listSupportTickets.mockResolvedValue([])
  })

  it('loads native pack content from the Content tab', async () => {
    api.getNativePackContent.mockResolvedValue({
      pack: { id: 'system-1', name: 'Pediatrics', description: '', questionCount: 2, createdAt: 'now', updatedAt: 'now' },
      native: true,
      manifest: {
        packId: 'pediatrics',
        title: 'Pediatrics',
        revision: { number: 3, hash: 'hash' },
        validation: { status: 'passed', errors: [], warnings: [], blockedQuestionCount: 0 },
        activeQuestionCount: 2,
        totalQuestionCount: 3
      },
      validation: { ok: true, errors: [], warnings: [] },
      questions: [
        {
          id: 'peds.s001.q01',
          path: 'questions/peds.s001.q01.json',
          status: 'ready',
          titlePreview: 'Question',
          contentHash: 'hash',
          correctChoiceId: 'B',
          tags: { rotation: 'Pediatrics', topic: 'Pulmonology' },
          source: { documentId: 'deck', slideNumber: 1 },
          parserConfidence: 0.9,
          reviewStatus: 'approved',
          validationStatus: 'passed',
          warnings: [],
          changeSummary: '',
          replacesQuestionId: ''
        }
      ]
    })

    render(<AdminPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Content' }))
    await userEvent.selectOptions(screen.getByDisplayValue('Select a library pack'), 'system-1')
    await userEvent.click(screen.getByRole('button', { name: 'Load Content' }))

    await waitFor(() => {
      expect(api.getNativePackContent).toHaveBeenCalledWith('system-1')
    })
    expect(await screen.findByText('pediatrics')).toBeInTheDocument()
    expect(screen.getByText('peds.s001.q01')).toBeInTheDocument()
  })
})
