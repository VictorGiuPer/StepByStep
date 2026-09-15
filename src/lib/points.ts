import type { SupabaseClient } from '@supabase/supabase-js'
import type { HabitInput, Redemption } from '@/types'
import { isDemoMode } from './demo'

export class AppServiceError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'AppServiceError'
  }
}

export function friendlyError(error: unknown): AppServiceError {
  const candidate = error as { message?: string; code?: string }
  const source = candidate?.message || 'Something went wrong. Please try again.'
  const mappings: Array<[RegExp, string]> = [
    [/invalid login credentials/i, 'That email and password do not match.'],
    [/already completed/i, 'This habit is already complete for that interval.'],
    [/not scheduled/i, 'That day is not part of this habit’s schedule.'],
    [/future completions/i, 'You cannot log a future completion.'],
    [/not enough points/i, 'There are not enough points for this reward.'],
    [/other partner must decide/i, 'Only your partner can decide your reward request.'],
    [/referenced from table/i, 'Reassign the habits in this category before deleting it.'],
  ]
  return new AppServiceError(mappings.find(([pattern]) => pattern.test(source))?.[1] ?? source, candidate?.code)
}

export function habitRpcPayload(input: HabitInput) {
  return {
    p_habit_id: input.id ?? null,
    p_name: input.name.trim(),
    p_icon: input.icon,
    p_category_id: input.categoryId,
    p_type: input.type,
    p_scope: input.scope,
    p_frequency: input.frequency,
    p_custom_days: input.frequency === 'custom_days' ? input.customDays : null,
    p_size: input.size,
    p_archived: input.archived,
  }
}

export async function saveHabit(client: SupabaseClient, input: HabitInput) {
  if (isDemoMode) return { id: input.id ?? 'preview-habit' }
  const { data, error } = await client.rpc('save_habit', habitRpcPayload(input))
  if (error) throw friendlyError(error)
  return data
}

export async function logCompletion(client: SupabaseClient, habitId: string, date: string, note?: string) {
  if (isDemoMode) return { base_points_awarded: 1, streak_bonus_awarded: 0 }
  const { data, error } = await client.rpc('log_or_restore_habit_completion', {
    p_habit_id: habitId,
    p_completion_date: date,
    p_note: note?.trim() || null,
  })
  if (error) throw friendlyError(error)
  return Array.isArray(data) ? data[0] : data
}

export async function undoTodayCompletion(client: SupabaseClient, habitId: string) {
  if (isDemoMode) return { balance: 0, current_streak: 0 }
  const { data, error } = await client.rpc('undo_today_habit_completion', { p_habit_id: habitId })
  if (error) throw friendlyError(error)
  return Array.isArray(data) ? data[0] : data
}

export async function requestRedemption(client: SupabaseClient, rewardId: string): Promise<Redemption> {
  if (isDemoMode) return { id: 'preview-redemption', reward_id: rewardId, reward_name_snapshot: 'Preview reward', point_cost_snapshot: 0, redeemed_by: 'preview-user', date_requested: new Date().toISOString().slice(0, 10), date_confirmed: null, date_decided: null, decided_by: null, decision_note: null, status: 'pending_confirmation', created_at: new Date().toISOString() }
  const { data, error } = await client.rpc('request_redemption', { p_reward_id: rewardId })
  if (error) throw friendlyError(error)
  return data as Redemption
}

export async function decideRedemption(client: SupabaseClient, redemptionId: string, decision: 'confirmed' | 'declined', reason?: string): Promise<Redemption> {
  if (isDemoMode) return { id: redemptionId, reward_id: 'preview-reward', reward_name_snapshot: 'Preview reward', point_cost_snapshot: 0, redeemed_by: 'preview-user', date_requested: new Date().toISOString().slice(0, 10), date_confirmed: decision === 'confirmed' ? new Date().toISOString().slice(0, 10) : null, date_decided: new Date().toISOString().slice(0, 10), decided_by: 'preview-user', decision_note: reason?.trim() || null, status: decision, created_at: new Date().toISOString() }
  const { data, error } = await client.rpc('decide_redemption', {
    p_redemption_id: redemptionId,
    p_decision: decision,
    p_reason: reason?.trim() || null,
  })
  if (error) throw friendlyError(error)
  return data as Redemption
}
