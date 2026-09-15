export type HabitType = 'build' | 'avoid'
export type HabitScope = 'personal' | 'shared'
export type HabitFrequency = 'daily' | 'weekly' | 'custom_days'
export type HabitSize = 'small' | 'medium' | 'large'
export type RedemptionStatus = 'pending_confirmation' | 'confirmed' | 'declined'
export type LedgerSource = 'habit_completion' | 'streak_bonus' | 'habit_completion_reversal' | 'habit_completion_restore' | 'reward_redemption'

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
}

export interface AppSettings {
  id: number
  timezone: string
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  sort_order: number
  created_by: string | null
}

export interface Habit {
  id: string
  name: string
  icon: string
  category_id: string
  type: HabitType
  scope: HabitScope
  owner_user_id: string | null
  frequency: HabitFrequency
  custom_days: number[] | null
  size: HabitSize
  base_points: number
  archived: boolean
  created_at: string
  updated_at: string
}

export interface HabitSchedule {
  id: string
  habit_id: string
  frequency: HabitFrequency
  custom_days: number[] | null
  effective_from: string
  effective_to: string | null
}

export interface Completion {
  id: string
  habit_id: string
  schedule_version_id: string
  user_id: string
  date: string
  interval_start: string
  note: string | null
  base_points_snapshot: number
  created_at: string
  voided_at?: string | null
  voided_by?: string | null
}

export interface Reward {
  id: string
  name: string
  description: string | null
  point_cost: number
  icon: string
  created_by: string
  archived: boolean
  created_at: string
  updated_at: string
}

export interface Redemption {
  id: string
  reward_id: string
  reward_name_snapshot: string
  point_cost_snapshot: number
  redeemed_by: string
  date_requested: string
  date_confirmed: string | null
  date_decided: string | null
  decided_by: string | null
  decision_note: string | null
  status: RedemptionStatus
  created_at: string
}

export interface LedgerEntry {
  id: string
  user_id: string
  date: string
  points: number
  source: LedgerSource
  created_at: string
  habit_completion_id: string | null
  redemption_id: string | null
  habit_id: string | null
  habit_name: string | null
  category_id: string | null
  category_name: string | null
  reward_name: string | null
}

export interface FeedEntry {
  id: string
  user_id: string
  display_name: string
  habit_id: string
  habit_name: string
  habit_icon: string
  category_id: string
  category_name: string
  date: string
  note: string | null
  created_at: string
}

export interface HabitStreak {
  habit_id: string
  user_id: string
  current_streak: number
}

export interface AppSnapshot {
  profiles: Profile[]
  settings: AppSettings
  categories: Category[]
  habits: Habit[]
  schedules: HabitSchedule[]
  completions: Completion[]
  balance: number
  rewards: Reward[]
  redemptions: Redemption[]
  ledger: LedgerEntry[]
  feed: FeedEntry[]
  streaks: HabitStreak[]
}

export interface HabitInput {
  id?: string
  name: string
  icon: string
  categoryId: string
  type: HabitType
  scope: HabitScope
  frequency: HabitFrequency
  customDays: number[]
  size: HabitSize
  archived: boolean
}
