import { describe, expect, it } from 'vitest'
import { friendlyError, habitRpcPayload } from './points'

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
})
