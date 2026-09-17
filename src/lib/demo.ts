import { addDays, dateKeyInTimeZone, intervalStart, resolveSchedule } from './date'
import type { AppSnapshot, Category, Habit, Redemption } from '@/types'

export const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111'
export const PARTNER_USER_ID = '22222222-2222-4222-8222-222222222222'

// Preview mode is intentionally compiled out of production builds. It exists only
// to let the local UI be explored while a development Supabase project is offline.
export const isDemoMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1'

export function createDemoSnapshot(): AppSnapshot {
  const today = dateKeyInTimeZone('Europe/Brussels')
  const day = (offset: number) => addDays(today, offset)
  const categories: Category[] = [
    { id: 'c-health', name: 'Health & Body', icon: 'Dumbbell', color: '#758BFD', sort_order: 1, created_by: null },
    { id: 'c-mind', name: 'Mind & Reflection', icon: 'Brain', color: '#FF8600', sort_order: 2, created_by: null },
    { id: 'c-home', name: 'Home & Life Admin', icon: 'House', color: '#27187E', sort_order: 3, created_by: null },
  ]
  const habit = (value: Omit<Habit, 'created_at' | 'updated_at'>): Habit => ({ ...value, created_at: `${day(-35)}T09:00:00Z`, updated_at: `${today}T08:00:00Z` })
  const habits: Habit[] = [
    habit({ id: 'h-stretch', name: 'Morning stretch', icon: 'Sun', category_id: 'c-health', type: 'build', scope: 'personal', owner_user_id: DEMO_USER_ID, frequency: 'daily', custom_days: null, size: 'small', base_points: 1, archived: false }),
    habit({ id: 'h-walk', name: 'After-dinner walk', icon: 'Footprints', category_id: 'c-health', type: 'build', scope: 'shared', owner_user_id: null, frequency: 'daily', custom_days: null, size: 'medium', base_points: 2, archived: false }),
    habit({ id: 'h-journal', name: 'Three-line journal', icon: 'NotebookPen', category_id: 'c-mind', type: 'build', scope: 'personal', owner_user_id: DEMO_USER_ID, frequency: 'custom_days', custom_days: [1, 3, 5], size: 'small', base_points: 1, archived: false }),
    habit({ id: 'h-reset', name: 'Sunday reset', icon: 'Sparkles', category_id: 'c-home', type: 'build', scope: 'shared', owner_user_id: null, frequency: 'weekly', custom_days: null, size: 'large', base_points: 3, archived: false }),
  ]
  const schedules = habits.map((habit) => ({ id: `s-${habit.id}`, habit_id: habit.id, frequency: habit.frequency, custom_days: habit.custom_days, effective_from: day(-35), effective_to: null }))
  const completionRows = [
    ['h-stretch', DEMO_USER_ID, -1, 'Started the day gently.'], ['h-stretch', DEMO_USER_ID, -2, null], ['h-stretch', DEMO_USER_ID, -3, null],
    ['h-walk', DEMO_USER_ID, -1, 'Warm evening walk.'], ['h-walk', PARTNER_USER_ID, -2, null], ['h-walk', PARTNER_USER_ID, -3, null],
    ['h-journal', DEMO_USER_ID, -3, 'Grateful for slow mornings.'], ['h-journal', DEMO_USER_ID, -7, null], ['h-reset', DEMO_USER_ID, -8, 'Kitchen and calendar sorted.'],
  ] as const
  const completions = completionRows.map(([habitId, userId, offset, note], index) => ({ id: `completion-${index}`, habit_id: habitId, schedule_version_id: `s-${habitId}`, user_id: userId, date: day(offset), interval_start: habitId === 'h-reset' ? day(-8) : day(offset), note, base_points_snapshot: habits.find((habit) => habit.id === habitId)?.base_points ?? 1, created_at: `${day(offset)}T18:30:00Z` }))
  const ledger = completions.map((completion, index) => {
    const habit = habits.find((item) => item.id === completion.habit_id)!
    const category = categories.find((item) => item.id === habit.category_id)!
    return { id: `ledger-${index}`, user_id: completion.user_id, date: completion.date, points: completion.base_points_snapshot, source: 'habit_completion' as const, created_at: completion.created_at, habit_completion_id: completion.id, redemption_id: null, habit_id: habit.id, habit_name: habit.name, category_id: category.id, category_name: category.name, reward_name: null }
  }).filter((entry) => entry.user_id === DEMO_USER_ID)
  return {
    profiles: [{ id: DEMO_USER_ID, display_name: 'Nadine', avatar_url: null }, { id: PARTNER_USER_ID, display_name: 'Victor', avatar_url: null }],
    settings: { id: 1, timezone: 'Europe/Brussels' }, categories: [...categories], habits, todos: [], todoCompletions: [], weeklyProgress: [], schedules, completions, balance: 24, balances: [{ user_id: DEMO_USER_ID, balance: 24 }, { user_id: PARTNER_USER_ID, balance: 18 }], connection: { state: 'connected', request_id: null, requested_by: null, requested_to: null, created_at: null },
    rewards: [
      { id: 'r-pizza', name: 'Domino’s night', description: 'Pick the movie, the toppings, and the blanket.', point_cost: 18, icon: 'Pizza', created_by: PARTNER_USER_ID, archived: false, created_at: `${day(-14)}T12:00:00Z`, updated_at: `${day(-14)}T12:00:00Z` },
      { id: 'r-massage', name: '30-minute massage', description: 'Phone-free, unhurried, and fully deserved.', point_cost: 24, icon: 'HeartHandshake', created_by: PARTNER_USER_ID, archived: false, created_at: `${day(-10)}T12:00:00Z`, updated_at: `${day(-10)}T12:00:00Z` },
      { id: 'r-dinner', name: 'Cook me dinner', description: 'Chef’s choice — dessert included.', point_cost: 15, icon: 'CookingPot', created_by: DEMO_USER_ID, archived: false, created_at: `${day(-6)}T12:00:00Z`, updated_at: `${day(-6)}T12:00:00Z` },
    ],
    redemptions: [{ id: 'redemption-1', reward_id: 'r-dinner', reward_name_snapshot: 'Cook me dinner', point_cost_snapshot: 15, redeemed_by: PARTNER_USER_ID, date_requested: day(-1), date_confirmed: null, date_decided: null, decided_by: null, decision_note: null, status: 'pending_confirmation', created_at: `${day(-1)}T19:00:00Z` }],
    ledger,
    feed: [{ id: 'feed-1', user_id: PARTNER_USER_ID, display_name: 'Victor', habit_id: 'h-walk', habit_name: 'After-dinner walk', habit_icon: 'Footprints', category_id: 'c-health', category_name: 'Health & Body', date: day(-1), note: 'Caught the sunset.', created_at: `${day(-1)}T19:10:00Z` }],
    streaks: [{ habit_id: 'h-stretch', user_id: DEMO_USER_ID, current_streak: 4 }, { habit_id: 'h-walk', user_id: DEMO_USER_ID, current_streak: 3 }, { habit_id: 'h-journal', user_id: DEMO_USER_ID, current_streak: 2 }, { habit_id: 'h-reset', user_id: DEMO_USER_ID, current_streak: 2 }],
  }
}

export function previewComplete(snapshot: AppSnapshot, userId: string, habitId: string) {
  const habit = snapshot.habits.find((item) => item.id === habitId)
  const date = dateKeyInTimeZone(snapshot.settings.timezone)
  const schedule = habit && resolveSchedule(habitId, date, snapshot.schedules)
  if (!habit || !schedule) throw new Error('That habit is not available in this preview.')
  const interval = intervalStart(schedule, date)
  if (snapshot.completions.some((item) => item.habit_id === habitId && item.user_id === userId && item.schedule_version_id === schedule.id && item.interval_start === interval)) throw new Error('This habit is already complete for today.')
  const previousStreak = snapshot.streaks.find((item) => item.habit_id === habitId && item.user_id === userId)?.current_streak ?? 0
  const bonus = Math.min(previousStreak, 5); const awarded = habit.base_points + bonus; const now = new Date().toISOString(); const id = `preview-completion-${Date.now()}`
  const category = snapshot.categories.find((item) => item.id === habit.category_id)
  const completion = { id, habit_id: habitId, schedule_version_id: schedule.id, user_id: userId, date, interval_start: interval, note: null, base_points_snapshot: habit.base_points, created_at: now }
  const ledger = { id: `preview-ledger-${Date.now()}`, user_id: userId, date, points: awarded, source: 'habit_completion' as const, created_at: now, habit_completion_id: id, redemption_id: null, habit_id: habitId, habit_name: habit.name, category_id: category?.id ?? null, category_name: category?.name ?? null, reward_name: null }
  const streaks = snapshot.streaks.some((item) => item.habit_id === habitId && item.user_id === userId) ? snapshot.streaks.map((item) => item.habit_id === habitId && item.user_id === userId ? { ...item, current_streak: item.current_streak + 1 } : item) : [...snapshot.streaks, { habit_id: habitId, user_id: userId, current_streak: 1 }]
  return { snapshot: { ...snapshot, completions: [...snapshot.completions, completion], ledger: [...snapshot.ledger, ledger], balance: snapshot.balance + awarded, streaks, feed: [{ id: `preview-feed-${Date.now()}`, user_id: userId, display_name: snapshot.profiles.find((item) => item.id === userId)?.display_name ?? 'You', habit_id: habitId, habit_name: habit.name, habit_icon: habit.icon, category_id: habit.category_id, category_name: category?.name ?? '', date, note: null, created_at: now }, ...snapshot.feed] }, result: { base_points_awarded: habit.base_points, streak_bonus_awarded: bonus } }
}

export function previewUndoTodayCompletion(snapshot: AppSnapshot, userId: string, habitId: string) {
  const date = dateKeyInTimeZone(snapshot.settings.timezone)
  const completion = [...snapshot.completions].reverse().find((item) => item.habit_id === habitId && item.user_id === userId && item.date === date && !item.voided_at)
  if (!completion) throw new Error('Only a completion from today can be undone.')
  const removedPoints = snapshot.ledger.filter((item) => item.habit_completion_id === completion.id).reduce((sum, item) => sum + item.points, 0)
  const streaks = snapshot.streaks.map((item) => item.habit_id === habitId && item.user_id === userId ? { ...item, current_streak: Math.max(0, item.current_streak - 1) } : item)
  return { ...snapshot, completions: snapshot.completions.map((item) => item.id === completion.id ? { ...item, voided_at: new Date().toISOString(), voided_by: userId } : item), ledger: snapshot.ledger.filter((item) => item.habit_completion_id !== completion.id), balance: snapshot.balance - removedPoints, streaks }
}

export function previewRequestRedemption(snapshot: AppSnapshot, userId: string, rewardId: string): { snapshot: AppSnapshot; redemption: Redemption } {
  const reward = snapshot.rewards.find((item) => item.id === rewardId)
  if (!reward || reward.archived) throw new Error('That reward is no longer available.')
  if (snapshot.balance < reward.point_cost) throw new Error('There are not enough points for this reward.')
  const now = new Date().toISOString(); const redemption: Redemption = { id: `preview-redemption-${Date.now()}`, reward_id: reward.id, reward_name_snapshot: reward.name, point_cost_snapshot: reward.point_cost, redeemed_by: userId, date_requested: now.slice(0, 10), date_confirmed: null, date_decided: null, decided_by: null, decision_note: null, status: 'pending_confirmation', created_at: now }
  return { snapshot: { ...snapshot, redemptions: [redemption, ...snapshot.redemptions] }, redemption }
}

export function previewDecideRedemption(snapshot: AppSnapshot, userId: string, redemptionId: string, decision: 'confirmed' | 'declined', reason?: string) {
  const date = dateKeyInTimeZone(snapshot.settings.timezone)
  const redemptions = snapshot.redemptions.map((item) => item.id === redemptionId ? { ...item, status: decision, decided_by: userId, date_decided: date, date_confirmed: decision === 'confirmed' ? date : null, decision_note: reason?.trim() || null } : item)
  return { ...snapshot, redemptions }
}
