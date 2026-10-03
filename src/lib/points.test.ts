import { describe, expect, it } from 'vitest'
import { friendlyError, habitRpcPayload, netPointsByCategory } from './points'
import type { LedgerEntry } from '@/types'

describe('points service contracts', () => {
  it('maps a custom-day habit to the RPC wire shape', () => {
    expect(habitRpcPayload({ name: 'Language practice', icon: 'Languages', categoryId: 'cat', type: 'build', scope: 'shared', frequency: 'custom_days', customDays: [1,3,5], size: 'medium', archived: false })).toEqual({ p_habit_id: null, p_name: 'Language practice', p_icon: 'Languages', p_category_id: 'cat', p_type: 'build', p_scope: 'shared', p_frequency: 'custom_days', p_custom_days: [1,3,5], p_size: 'medium', p_archived: false })
  })
  it('removes unused custom days for non-custom habits', () => {
    expect(habitRpcPayload({ name: 'Read', icon: 'BookOpen', categoryId: 'cat', type: 'build', scope: 'personal', frequency: 'daily', customDays: [1], size: 'small', archived: false }).p_custom_days).toBeNull()
  })
  it('turns database errors into actionable messages', () => {
    expect(friendlyError({ message: 'duplicate: already completed', code: '23505' }).message).toBe('This habit is already complete for that interval.')
    expect(friendlyError({ message: 'not enough points', code: '22003' }).message).toBe('There are not enough points for this reward.')
  })
  it('nets completion reversals into category totals', () => {
    const entry = (id: string, points: number, categoryName: string | null, userId = 'user-1'): LedgerEntry => ({ id, user_id: userId, date: '2026-10-03', points, source: points > 0 ? 'habit_completion' : 'habit_completion_reversal', created_at: '', habit_completion_id: 'completion-1', redemption_id: null, habit_id: 'habit-1', habit_name: 'Read', category_id: categoryName ? 'category-1' : null, category_name: categoryName, reward_name: null })
    expect(netPointsByCategory([
      entry('1', 3, 'Learning'),
      entry('2', -1, 'Learning'),
      entry('3', 4, 'Health'),
      entry('4', -8, null),
      entry('5', 99, 'Learning', 'partner'),
    ], 'user-1')).toEqual([{ name: 'Health', points: 4 }, { name: 'Learning', points: 2 }])
  })
})
