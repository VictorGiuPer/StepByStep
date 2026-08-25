import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MonthCalendar } from './MonthCalendar'

describe('MonthCalendar', () => {
  it('selects allowed history dates and blocks disabled dates', async () => {
    const user = userEvent.setup(); const select = vi.fn()
    render(<MonthCalendar dates={['2026-08-20']} initialDate="2026-08-22" onSelect={select} disabledDate={(date) => date > '2026-08-22'} />)
    await user.click(screen.getByRole('button', { name: '20 August 2026' })); expect(select).toHaveBeenCalledWith('2026-08-20')
    expect(screen.getByRole('button', { name: '23 August 2026' })).toBeDisabled()
  })
})
