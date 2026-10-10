import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { isCategoryAvailableToUser } from './categories'
import { isHabitAvailableToUser } from './date'
import { isTodoAvailableToUser } from './todos'
import { isDemoMode } from './demo'
import type { AppSettings, AppSnapshot, Category, Completion, CoupleConnection, FeedEntry, Habit, HabitSchedule, HabitStreak, HabitWeeklyProgress, LedgerEntry, PointBalance, Profile, Redemption, Reward, Todo, TodoCompletion } from '@/types'

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

export async function loadSnapshot(userId: string): Promise<AppSnapshot> {
  const [profiles, connection] = await Promise.all([
    supabase.from('profiles').select('id,display_name,avatar_url').order('created_at'),
    supabase.rpc('get_couple_link_state'),
  ])
  const visibleProfiles = unwrap(profiles) as Profile[]
  const connectionState = ((unwrap(connection) as CoupleConnection[])[0] ?? { state: 'unlinked', request_id: null, requested_by: null, requested_to: null, created_at: null }) as CoupleConnection
  if (!isDemoMode && connectionState.state === 'connected') {
    const penaltyResult = await supabase.rpc('apply_habit_miss_penalties')
    if (penaltyResult.error && !['PGRST202', '42883'].includes(penaltyResult.error.code ?? '')) {
      throw new Error(penaltyResult.error.message)
    }
  }
  const [settings, categories, habits, todos, todoCompletions, weeklyProgress, schedules, completions, balances, rewards, redemptions, ledger, feed, streakGroups] = await Promise.all([
    supabase.from('app_settings').select('id,timezone').eq('id', 1).single(),
    supabase.from('categories').select('*').order('sort_order').order('name'),
    supabase.from('habits').select('*').order('created_at'),
    supabase.from('todos').select('*').eq('archived', false).order('created_at'),
    supabase.from('todo_completions').select('*'),
    supabase.from('habit_weekly_progress').select('*'),
    supabase.from('habit_schedule_versions').select('*').order('effective_from'),
    supabase.from('habit_completions').select('*').order('date'),
    supabase.from('point_balances').select('user_id,balance'),
    supabase.from('rewards').select('*').order('created_at', { ascending: false }),
    supabase.from('redemptions').select('*').order('created_at', { ascending: false }),
    supabase.from('ledger_history').select('*').order('date').order('created_at'),
    supabase.from('completion_feed').select('*').order('created_at', { ascending: false }).limit(30),
    connectionState.state === 'connected' ? Promise.all(visibleProfiles.map((profile) => supabase.rpc('get_habit_streaks', { p_user_id: profile.id }))) : Promise.resolve([]),
  ])
  const streaks = streakGroups.flatMap((result) => unwrap(result) as HabitStreak[])
  const pointBalances = (unwrap(balances) as Array<{ user_id: string; balance: number | string }>).map((item) => ({ user_id: item.user_id, balance: Number(item.balance) }))
  const visibleCategories = (unwrap(categories) as Category[]).filter((category) => isCategoryAvailableToUser(category, userId))
  const visibleHabits = (unwrap(habits) as Habit[]).filter((habit) => isHabitAvailableToUser(habit, userId))
  const visibleTodos = (unwrap(todos) as Todo[]).filter((todo) => isTodoAvailableToUser(todo, userId))
  const visibleHabitIds = new Set(visibleHabits.map((habit) => habit.id))
  const sharedHabitIds = new Set(visibleHabits.filter((habit) => habit.scope === 'shared').map((habit) => habit.id))
  const visibleTodoIds = new Set(visibleTodos.map((todo) => todo.id))

  return {
    profiles: visibleProfiles,
    settings: unwrap(settings) as AppSettings,
    categories: visibleCategories,
    habits: visibleHabits,
    todos: visibleTodos,
    todoCompletions: (unwrap(todoCompletions) as TodoCompletion[]).filter((item) => visibleTodoIds.has(item.todo_id)),
    weeklyProgress: (unwrap(weeklyProgress) as HabitWeeklyProgress[]).filter((item) => visibleHabitIds.has(item.habit_id) && (sharedHabitIds.has(item.habit_id) || item.user_id === userId)),
    schedules: (unwrap(schedules) as HabitSchedule[]).filter((item) => visibleHabitIds.has(item.habit_id)),
    completions: (unwrap(completions) as Completion[]).filter((item) => visibleHabitIds.has(item.habit_id) && (sharedHabitIds.has(item.habit_id) || item.user_id === userId)),
    balance: pointBalances.find((item) => item.user_id === userId)?.balance ?? 0,
    balances: pointBalances as PointBalance[],
    connection: connectionState,
    rewards: unwrap(rewards) as Reward[],
    redemptions: unwrap(redemptions) as Redemption[],
    ledger: (unwrap(ledger) as LedgerEntry[]).filter((item) => !item.habit_id || visibleHabitIds.has(item.habit_id)),
    feed: (unwrap(feed) as FeedEntry[]).filter((item) => visibleHabitIds.has(item.habit_id)),
    streaks: streaks.filter((item) => visibleHabitIds.has(item.habit_id)),
  }
}

export function useAppSnapshot(userId: string) {
  return useQuery({ queryKey: ['snapshot', userId], queryFn: () => loadSnapshot(userId), staleTime: 20_000 })
}

export function useRealtimeRefresh(userId: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['snapshot', userId] })
    const channel = supabase
      .channel(`step-by-step-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'habit_completions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_completions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_weekly_progress' }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'points_ledger' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rewards' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redemptions' }, refresh)
      .subscribe()
    const onOnline = () => refresh()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      void supabase.removeChannel(channel)
    }
  }, [queryClient, userId])
}
