import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'

const api = vi.hoisted(() => ({
  beginFolderImport: vi.fn(),
  cancelFolderImport: vi.fn(),
  completeFolderImport: vi.fn(),
  deleteStudyPack: vi.fn(),
  getSession: vi.fn(),
  importStudyPack: vi.fn(),
  listStudyPacks: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  uploadFolderImportBatch: vi.fn()
}))

const navigation = vi.hoisted(() => ({
  navigate: vi.fn()
}))

vi.mock('../lib/api', () => api)
vi.mock('../lib/navigation', () => navigation)

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders study packs for authenticated users and opens a pack', async () => {
    api.getSession.mockResolvedValue({ id: 'u1', username: 'ahmad', createdAt: 'now' })
    api.listStudyPacks.mockResolvedValue([{ id: 'pack-1', name: 'Pack', questionCount: 40, revision: 2, createdAt: 'now', updatedAt: 'now' }])
    render(<HomePage />)

    expect(await screen.findByText('Available Study Packs')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(navigation.navigate).toHaveBeenCalledWith('overview', { pack: 'pack-1' })
  })

  it('submits login credentials', async () => {
    api.getSession.mockResolvedValue(null)
    api.login.mockResolvedValue({ id: 'u1', username: 'ahmad', createdAt: 'now' })
    api.listStudyPacks.mockResolvedValue([])
    render(<HomePage />)

    await userEvent.type(await screen.findByLabelText(/username/i), 'ahmad')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith('ahmad', 'secret')
    })
  })
})
