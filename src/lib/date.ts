import type { Completion, Habit, HabitSchedule } from '@/types'

const dayMs = 86_400_000

export function dateKeyInTimeZone(timeZone: string, value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`)
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(key: string, amount: number): string {
  return toDateKey(new Date(parseDateKey(key).getTime() + amount * dayMs))
}

export function isoWeekday(key: string): number {
  const day = parseDateKey(key).getUTCDay()
  return day === 0 ? 7 : day
}

export function weekStart(key: string): string {
  return addDays(key, 1 - isoWeekday(key))
}

export function formatDate(key: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(parseDateKey(key))
}

export function formatFullDate(key: string): string {
  return formatDate(key, { weekday: 'short', day: 'numeric', month: 'long' })
}

export function monthLabel(key: string): string {
  return formatDate(key, { month: 'long', year: 'numeric' })
}

export function monthGrid(anchorKey: string): Array<{ key: string; inMonth: boolean }> {
  const anchor = parseDateKey(anchorKey)
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12))
  const firstKey = toDateKey(first)
  const gridStart = addDays(firstKey, 1 - isoWeekday(firstKey))
  return Array.from({ length: 42 }, (_, index) => {
    const key = addDays(gridStart, index)
    return { key, inMonth: parseDateKey(key).getUTCMonth() === anchor.getUTCMonth() }
  })
}

export function resolveSchedule(habitId: string, date: string, schedules: HabitSchedule[]): HabitSchedule | undefined {
  return schedules
    .filter((item) => item.habit_id === habitId && item.effective_from <= date && (!item.effective_to || item.effective_to >= date))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
}

export function isScheduledDate(schedule: Pick<HabitSchedule, 'frequency' | 'custom_days'>, date: string): boolean {
  if (schedule.frequency !== 'custom_days') return true
  return Boolean(schedule.custom_days?.includes(isoWeekday(date)))
}

export function intervalStart(schedule: Pick<HabitSchedule, 'frequency'>, date: string): string {
  return schedule.frequency === 'weekly' ? weekStart(date) : date
}

export function nextRequiredDate(date: string, schedule: Pick<HabitSchedule, 'frequency' | 'custom_days'>): string {
  if (schedule.frequency === 'daily') return addDays(date, 1)
  if (schedule.frequency === 'weekly') return addDays(weekStart(date), 7)
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(date, offset)
    if (schedule.custom_days?.includes(isoWeekday(candidate))) return candidate
  }
  return addDays(date, 7)
}

export function isHabitAvailableToUser(habit: Habit, userId: string): boolean {
  return habit.scope === 'shared' || habit.owner_user_id === userId
}

export function isHabitDue(
  habit: Habit,
  date: string,
  userId: string,
  schedules: HabitSchedule[],
): boolean {
  if (habit.archived || !isHabitAvailableToUser(habit, userId)) return false
  const schedule = resolveSchedule(habit.id, date, schedules)
  return Boolean(schedule && isScheduledDate(schedule, date))
}

export function completionForInterval(
  habitId: string,
  userId: string,
  date: string,
  schedules: HabitSchedule[],
  completions: Completion[],
): Completion | undefined {
  const schedule = resolveSchedule(habitId, date, schedules)
  if (!schedule) return undefined
  const expectedInterval = intervalStart(schedule, date)
  return completions.find((item) => item.habit_id === habitId && item.user_id === userId && item.schedule_version_id === schedule.id && item.interval_start === expectedInterval)
}

export function bonusForStreak(streak: number): number {
  return Math.max(0, Math.min(streak - 1, 5))
}

export function calculateStreak(
  schedule: HabitSchedule,
  completions: Array<Pick<Completion, 'interval_start' | 'date'>>,
  asOf: string,
): number {
  const ordered = [...completions]
    .filter((item) => item.date <= asOf)
    .sort((a, b) => a.interval_start.localeCompare(b.interval_start))
  let streak = 0
  let previous: string | undefined
  for (const completion of ordered) {
    streak = previous && completion.interval_start === nextRequiredDate(previous, schedule) ? streak + 1 : 1
    previous = completion.interval_start
  }
  if (!previous) return 0
  if (schedule.frequency === 'daily' && previous < addDays(asOf, -1)) return 0
  if (schedule.frequency === 'weekly' && previous < addDays(weekStart(asOf), -7)) return 0
  if (schedule.frequency === 'custom_days' && nextRequiredDate(previous, schedule) < asOf) return 0
  return streak
}

export function daysAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.max(0, Math.floor(diff / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
