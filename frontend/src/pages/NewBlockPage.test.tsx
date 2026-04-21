import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQbankInfoFixture } from '../test/fixtures'
import { NewBlockPage } from './NewBlockPage'

const api = vi.hoisted(() => ({
  startBlock: vi.fn()
}))

const navigation = vi.hoisted(() => ({
  navigate: vi.fn()
}))

const packHook = vi.hoisted(() => ({
  usePackPage: vi.fn()
}))

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api')
  return { ...(actual as object), ...api }
})
vi.mock('../lib/navigation', () => navigation)
vi.mock('../lib/usePackPage', () => packHook)

describe('NewBlockPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    packHook.usePackPage.mockReturnValue({
      loading: false,
      user: null,
      packId: 'pack-1',
      qbankinfo: createQbankInfoFixture(),
      error: '',
      setQbankinfo: vi.fn()
    })
    api.startBlock.mockResolvedValue({ blockKey: '7', revision: 10 })
  })

  it('starts a tutor block with grouped questions preserved', async () => {
    const { container } = render(<NewBlockPage />)
    expect(screen.getByRole('button', { name: /Tutor/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Timed/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Untimed/i })).not.toBeInTheDocument()
    expect(container.querySelector('.custom-control')).toBeNull()
    expect(container.querySelector('.badge-pill')).toBeNull()
    expect(container.querySelector('.badge-secondary')).toBeNull()
    expect(container.querySelectorAll('.q-count-pill').length).toBeGreaterThan(0)
    expect(container.querySelector('.q-inline-checkbox')).not.toBeNull()
    await userEvent.clear(screen.getByDisplayValue(''))
    const inputs = screen.getAllByRole('textbox')
    await userEvent.type(inputs[0]!, '1')
    await userEvent.click(screen.getByRole('button', { name: 'Start Block' }))

    expect(api.startBlock).toHaveBeenCalled()
    expect(navigation.navigate).toHaveBeenCalledWith('examview', { pack: 'pack-1', block: '7' })
  })
})
