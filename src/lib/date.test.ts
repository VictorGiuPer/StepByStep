import { describe, expect, it } from 'vitest'
import { bonusForStreak, calculateStreak, completionForInterval, dateKeyInTimeZone, intervalStart, isHabitDue, isoWeekday, weekStart } from './date'
import type { Completion, Habit, HabitSchedule } from '@/types'

const habit: Habit = { id: 'habit-1', name: 'Read', icon: 'BookOpen', category_id: 'category-1', type: 'build', scope: 'personal', owner_user_id: 'user-1', frequency: 'daily', custom_days: null, size: 'small', base_points: 1, archived: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const schedule = (frequency: HabitSchedule['frequency'], customDays: number[] | null = null): HabitSchedule => ({ id: `schedule-${frequency}`, habit_id: habit.id, frequency, custom_days: customDays, effective_from: '2026-01-01', effective_to: null })
const completion = (date: string, scheduleId = 'schedule-daily', interval = date): Completion => ({ id: date, habit_id: habit.id, schedule_version_id: scheduleId, user_id: 'user-1', date, interval_start: interval, note: null, base_points_snapshot: 1, created_at: `${date}T12:00:00Z` })

describe('household calendar rules', () => {
  it('formats a UTC instant in the household timezone', () => {
    expect(dateKeyInTimeZone('Europe/Brussels', new Date('2026-08-21T22:30:00Z'))).toBe('2026-08-22')
  })
  it('uses ISO weekdays and Monday week starts', () => {
    expect(isoWeekday('2026-08-23')).toBe(7)
    expect(weekStart('2026-08-23')).toBe('2026-08-17')
  })
  it('limits custom habits to configured weekdays', () => {
    const customHabit = { ...habit, frequency: 'custom_days' as const, custom_days: [1, 3, 5] }
    expect(isHabitDue(customHabit, '2026-08-24', 'user-1', [schedule('custom_days', [1,3,5])])).toBe(true)
    expect(isHabitDue(customHabit, '2026-08-25', 'user-1', [schedule('custom_days', [1,3,5])])).toBe(false)
  })
  it('matches weekly completions by Monday interval', () => {
    const weekly = schedule('weekly')
    const logged = completion('2026-08-20', weekly.id, '2026-08-17')
    expect(intervalStart(weekly, '2026-08-23')).toBe('2026-08-17')
    expect(completionForInterval(habit.id, 'user-1', '2026-08-23', [weekly], [logged])).toEqual(logged)
  })
})

describe('streak rules', () => {
  it('resets a daily streak after a completed required day is missed', () => {
    expect(calculateStreak(schedule('daily'), [completion('2026-08-18'), completion('2026-08-19')], '2026-08-22')).toBe(0)
  })
  it('keeps a weekly streak during the open current week', () => {
    const weekly = schedule('weekly')
    expect(calculateStreak(weekly, [completion('2026-08-11', weekly.id, '2026-08-10'), completion('2026-08-18', weekly.id, '2026-08-17')], '2026-08-22')).toBe(2)
  })
  it('checks only required custom weekdays', () => {
    const custom = schedule('custom_days', [1,3,5])
    expect(calculateStreak(custom, [completion('2026-08-17', custom.id), completion('2026-08-19', custom.id), completion('2026-08-21', custom.id)], '2026-08-22')).toBe(3)
  })
  it('caps a per-completion bonus at five', () => {
    expect([1,2,3,4,5,6,10].map(bonusForStreak)).toEqual([0,1,2,3,4,5,5])
  })
})
