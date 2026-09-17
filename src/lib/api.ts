import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
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

  return {
    profiles: visibleProfiles,
    settings: unwrap(settings) as AppSettings,
    categories: unwrap(categories) as Category[],
    habits: unwrap(habits) as Habit[],
    todos: unwrap(todos) as Todo[],
    todoCompletions: unwrap(todoCompletions) as TodoCompletion[],
    weeklyProgress: unwrap(weeklyProgress) as HabitWeeklyProgress[],
    schedules: unwrap(schedules) as HabitSchedule[],
    completions: unwrap(completions) as Completion[],
    balance: pointBalances.find((item) => item.user_id === userId)?.balance ?? 0,
    balances: pointBalances as PointBalance[],
    connection: connectionState,
    rewards: unwrap(rewards) as Reward[],
    redemptions: unwrap(redemptions) as Redemption[],
    ledger: unwrap(ledger) as LedgerEntry[],
    feed: unwrap(feed) as FeedEntry[],
    streaks,
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
