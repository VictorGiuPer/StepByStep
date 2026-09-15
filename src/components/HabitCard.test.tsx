import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HabitCard } from './HabitCard'
import type { Category, Habit } from '@/types'

const habit: Habit = { id: 'h1', name: 'Morning stretch', icon: 'Heart', category_id: 'c1', type: 'build', scope: 'personal', owner_user_id: 'u1', frequency: 'daily', custom_days: null, size: 'medium', base_points: 2, archived: false, created_at: '', updated_at: '' }
const category: Category = { id: 'c1', name: 'Health & Body', icon: 'HeartPulse', color: '#FF8600', sort_order: 1, created_by: null }

describe('HabitCard', () => {
  it('supports one-tap completion without an edit target', async () => {
    const user = userEvent.setup(); const complete = vi.fn()
    render(<HabitCard habit={habit} category={category} streak={4} completed={false} onComplete={complete} />)
    expect(screen.getByText('Morning stretch')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Complete Morning stretch' })); expect(complete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Open Morning stretch' })).not.toBeInTheDocument()
  })
  it('offers an undo action after the interval is done', () => {
    render(<HabitCard habit={habit} category={category} streak={5} completed onComplete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Complete Morning stretch' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo Morning stretch completion' })).toBeDisabled()
  })
})
