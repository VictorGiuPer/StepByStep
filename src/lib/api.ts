import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { AppSettings, AppSnapshot, Category, Completion, FeedEntry, Habit, HabitSchedule, HabitStreak, LedgerEntry, Profile, Redemption, Reward } from '@/types'

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

export async function loadSnapshot(userId: string): Promise<AppSnapshot> {
  const [profiles, settings, categories, habits, schedules, completions, balance, rewards, redemptions, ledger, feed, streaks] = await Promise.all([
    supabase.from('profiles').select('id,display_name,avatar_url').order('created_at'),
    supabase.from('app_settings').select('id,timezone').eq('id', 1).single(),
    supabase.from('categories').select('*').order('sort_order').order('name'),
    supabase.from('habits').select('*').order('created_at'),
    supabase.from('habit_schedule_versions').select('*').order('effective_from'),
    supabase.from('habit_completions').select('*').order('date'),
    supabase.from('point_balances').select('balance').eq('user_id', userId).maybeSingle(),
    supabase.from('rewards').select('*').order('created_at', { ascending: false }),
    supabase.from('redemptions').select('*').order('created_at', { ascending: false }),
    supabase.from('ledger_history').select('*').eq('user_id', userId).order('date').order('created_at'),
    supabase.from('completion_feed').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.rpc('get_habit_streaks', { p_user_id: userId }),
  ])

  return {
    profiles: unwrap(profiles) as Profile[],
    settings: unwrap(settings) as AppSettings,
    categories: unwrap(categories) as Category[],
    habits: unwrap(habits) as Habit[],
    schedules: unwrap(schedules) as HabitSchedule[],
    completions: unwrap(completions) as Completion[],
    balance: Number(unwrap(balance)?.balance ?? 0),
    rewards: unwrap(rewards) as Reward[],
    redemptions: unwrap(redemptions) as Redemption[],
    ledger: unwrap(ledger) as LedgerEntry[],
    feed: unwrap(feed) as FeedEntry[],
    streaks: unwrap(streaks) as HabitStreak[],
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
