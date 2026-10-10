import { describe, expect, it } from 'vitest'
import { createDemoSnapshot, DEMO_USER_ID, previewComplete, previewRequestRedemption, previewUndoTodayCompletion } from './demo'

describe('local preview state', () => {
  it('marks a habit complete and updates the local balance', () => {
    const snapshot = createDemoSnapshot()
    const result = previewComplete(snapshot, DEMO_USER_ID, 'h-stretch')
    expect(result.snapshot.completions).toHaveLength(snapshot.completions.length + 1)
    expect(result.snapshot.balance).toBe(snapshot.balance + result.result.base_points_awarded + result.result.streak_bonus_awarded)
    expect(result.snapshot.streaks.find((item) => item.habit_id === 'h-stretch')?.current_streak).toBe(5)
    expect(result.result.streak_bonus_awarded).toBe(0)
  })

  it('awards a preview streak bonus at the one-week milestone only', () => {
    const snapshot = createDemoSnapshot()
    snapshot.streaks = snapshot.streaks.map((item) => item.habit_id === 'h-stretch' ? { ...item, current_streak: 6 } : item)
    const result = previewComplete(snapshot, DEMO_USER_ID, 'h-stretch')
    expect(result.result.streak_bonus_awarded).toBe(1)
  })

  it('creates a pending local reward request without changing the balance', () => {
    const snapshot = createDemoSnapshot()
    const result = previewRequestRedemption(snapshot, DEMO_USER_ID, 'r-pizza')
    expect(result.snapshot.balance).toBe(snapshot.balance)
    expect(result.snapshot.redemptions[0]).toMatchObject({ reward_id: 'r-pizza', redeemed_by: DEMO_USER_ID, status: 'pending_confirmation' })
  })

  it('undoes a completion made today in the local preview', () => {
    const snapshot = createDemoSnapshot(); const completed = previewComplete(snapshot, DEMO_USER_ID, 'h-stretch')
    const undone = previewUndoTodayCompletion(completed.snapshot, DEMO_USER_ID, 'h-stretch')
    expect(undone.balance).toBe(snapshot.balance)
    expect(undone.completions.find((item) => item.id === completed.snapshot.completions.at(-1)?.id)?.voided_at).toBeTruthy()
  })
})
