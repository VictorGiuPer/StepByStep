import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check, Clock3, Flame, Gift, Sparkles } from 'lucide-react'
import { dateKeyInTimeZone, daysAgo, formatFullDate, completionForInterval, isHabitDue } from '@/lib/date'
import { decideRedemption, logCompletion } from '@/lib/points'
import { supabase } from '@/lib/supabase'
import type { AppSnapshot, Habit, Redemption } from '@/types'
import { AppIcon } from '@/components/AppIcon'
import { HabitCard } from '@/components/HabitCard'
import { HabitModal } from '@/components/HabitModal'
import { MonthCalendar } from '@/components/MonthCalendar'
import { Button, Card, EmptyState, inputClass, Notice } from '@/components/ui'

function ApprovalCard({ redemption, snapshot, userId }: { redemption: Redemption; snapshot: AppSnapshot; userId: string }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (decision: 'confirmed' | 'declined') => decideRedemption(supabase, redemption.id, decision, reason),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['snapshot', userId] }),
    onError: (value) => setError((value as Error).message),
  })
  const requester = snapshot.profiles.find((profile) => profile.id === redemption.redeemed_by)?.display_name ?? 'Your partner'
  return <div className="rounded-3xl bg-white p-4 shadow-soft"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-white"><Gift size={20} /></span><div className="min-w-0 flex-1"><p className="font-black">{requester} wants to redeem</p><p className="mt-0.5 truncate text-sm font-bold text-action">{redemption.reward_name_snapshot} · {redemption.point_cost_snapshot} pts</p></div></div><input className={`${inputClass} mt-3 min-h-9 py-2 text-xs`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Optional note if declining" />{error && <div className="mt-2"><Notice>{error}</Notice></div>}<div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate('declined')}>Decline</Button><Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate('confirmed')}><Check size={15} /> Confirm</Button></div></div>
}

export function DashboardPage({ snapshot, userId, onAddHabit }: { snapshot: AppSnapshot; userId: string; onAddHabit: () => void }) {
  const queryClient = useQueryClient()
  const today = dateKeyInTimeZone(snapshot.settings.timezone)
  const [selectedHabit, setSelectedHabit] = useState<Habit | null>(null)
  const [completeError, setCompleteError] = useState('')
  const complete = useMutation({
    mutationFn: (habitId: string) => logCompletion(supabase, habitId, today),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['snapshot', userId] }),
    onError: (error) => setCompleteError((error as Error).message),
  })
  const dueHabits = useMemo(() => snapshot.habits.filter((habit) => isHabitDue(habit, today, userId, snapshot.schedules)), [snapshot.habits, snapshot.schedules, today, userId])
  const grouped = snapshot.categories.map((category) => ({ category, habits: dueHabits.filter((habit) => habit.category_id === category.id) })).filter((group) => group.habits.length)
  const completedToday = snapshot.completions.filter((item) => item.user_id === userId && item.date === today).length
  const pendingIncoming = snapshot.redemptions.filter((item) => item.status === 'pending_confirmation' && item.redeemed_by !== userId)
  const partnerFeed = snapshot.feed.filter((item) => item.user_id !== userId).slice(0, 6)
  const userDates = snapshot.completions.filter((item) => item.user_id === userId).map((item) => item.date)

  return <>
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-extrabold text-action">{formatFullDate(today)}</p><h1 className="mt-1 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Small steps, shared joy.</h1><p className="mt-2 text-sm leading-6 text-ink/55">{dueHabits.length ? `${Math.max(0, dueHabits.length - completedToday)} habits are still waiting for you.` : 'Your rhythm is clear for today.'}</p></div><Button variant="accent" onClick={onAddHabit}><Sparkles size={18} /> Add habit</Button></div>
    {completeError && <div className="mb-4"><Notice>{completeError}</Notice></div>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(310px,.65fr)]">
      <div className="space-y-5">
        {grouped.length ? grouped.map(({ category, habits }) => <section key={category.id} className="rounded-[30px] bg-surface/65 p-4 sm:p-5"><div className="mb-3 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl text-white" style={{ backgroundColor: category.color }}><AppIcon name={category.icon} size={17} /></span><div><h2 className="font-black">{category.name}</h2><p className="text-[11px] font-bold text-ink/40">{habits.length} due</p></div></div><div className="space-y-3">{habits.map((habit) => <HabitCard key={habit.id} habit={habit} category={category} streak={snapshot.streaks.find((item) => item.habit_id === habit.id)?.current_streak ?? 0} completed={Boolean(completionForInterval(habit.id, userId, today, snapshot.schedules, snapshot.completions))} busy={complete.isPending} onComplete={() => { setCompleteError(''); complete.mutate(habit.id) }} onOpen={() => setSelectedHabit(habit)} />)}</div></section>) : <EmptyState icon={<Flame />} title="Nothing due today" body="Enjoy the breathing room, or add a habit when you’re ready for a new rhythm." action={<Button variant="accent" onClick={onAddHabit}>Add a habit</Button>} />}
      </div>
      <aside className="space-y-5">
        {pendingIncoming.length > 0 && <section><div className="mb-3 flex items-center gap-2"><BellRing className="text-accent" size={18} /><h2 className="font-black">Waiting for you</h2></div><div className="space-y-3">{pendingIncoming.map((item) => <ApprovalCard key={item.id} redemption={item} snapshot={snapshot} userId={userId} />)}</div></section>}
        <Card><div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-ink/40">This month</p><h2 className="mt-1 text-lg font-black">Your rhythm</h2></div><Flame className="text-accent" fill="currentColor" /></div><MonthCalendar dates={userDates} initialDate={today} compact /></Card>
        <Card className="bg-ink text-white"><div className="mb-4 flex items-center gap-2"><Clock3 size={17} className="text-accent" /><h2 className="font-black">Partner activity</h2></div>{partnerFeed.length ? <div className="space-y-4">{partnerFeed.map((entry) => <div key={entry.id} className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/10 text-accent"><AppIcon name={entry.habit_icon} size={18} /></span><p className="text-sm leading-5"><strong>{entry.display_name}</strong> logged {entry.habit_name}<span className="mt-0.5 block text-xs font-semibold text-white/40">{entry.date === today ? 'Today' : formatFullDate(entry.date)} · {daysAgo(entry.created_at)}</span></p></div>)}</div> : <p className="text-sm leading-6 text-white/50">Your partner’s completions will appear here in real time.</p>}</Card>
      </aside>
    </div>
    <HabitModal open={Boolean(selectedHabit)} onClose={() => setSelectedHabit(null)} habit={selectedHabit} snapshot={snapshot} userId={userId} />
  </>
}
