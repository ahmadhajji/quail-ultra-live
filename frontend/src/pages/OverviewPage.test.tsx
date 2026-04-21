import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createQbankInfoFixture } from '../test/fixtures'
import { OverviewPage } from './OverviewPage'

const packHook = vi.hoisted(() => ({
  usePackPage: vi.fn()
}))

vi.mock('../lib/usePackPage', () => packHook)

describe('OverviewPage', () => {
  it('renders derived block statistics', () => {
    packHook.usePackPage.mockReturnValue({
      loading: false,
      user: null,
      packId: 'pack-1',
      qbankinfo: createQbankInfoFixture(),
      error: '',
      setQbankinfo: vi.fn()
    })

    const { container } = render(<OverviewPage />)
    expect(screen.getByText('Tutor Blocks')).toBeInTheDocument()
    expect(screen.getByText('Average Time Per Question')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.q-panel-body.q-table-wrap')).toHaveLength(4)
    expect(container.querySelector('.table-bordered')).toBeNull()
  })
})
