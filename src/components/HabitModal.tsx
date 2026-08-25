import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, CalendarCheck, Check, Flame, Save } from 'lucide-react'
import { dateKeyInTimeZone, formatDate, intervalStart, isScheduledDate, resolveSchedule } from '@/lib/date'
import { logCompletion, saveHabit } from '@/lib/points'
import { supabase } from '@/lib/supabase'
import type { AppSnapshot, Habit, HabitFrequency, HabitInput, HabitScope, HabitSize, HabitType } from '@/types'
import { AppIcon, iconNames } from './AppIcon'
import { MonthCalendar } from './MonthCalendar'
import { Button, inputClass, Label, Modal, Notice } from './ui'

const weekdays = [{ value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 7, label: 'Sun' }]

function initialInput(habit: Habit | null, categoryId: string): HabitInput {
  return habit ? {
    id: habit.id, name: habit.name, icon: habit.icon, categoryId: habit.category_id, type: habit.type,
    scope: habit.scope, frequency: habit.frequency, customDays: habit.custom_days ?? [], size: habit.size, archived: habit.archived,
  } : { name: '', icon: 'Sparkles', categoryId, type: 'build', scope: 'personal', frequency: 'daily', customDays: [1, 3, 5], size: 'small', archived: false }
}

interface HabitModalProps { open: boolean; onClose: () => void; habit: Habit | null; snapshot: AppSnapshot; userId: string; initialCategoryId?: string }

function HabitModalContent({ open, onClose, habit, snapshot, userId, initialCategoryId }: HabitModalProps) {
  const queryClient = useQueryClient()
  const today = dateKeyInTimeZone(snapshot.settings.timezone)
  const defaultCategory = habit?.category_id ?? initialCategoryId ?? snapshot.categories[0]?.id ?? ''
  const [form, setForm] = useState<HabitInput>(() => initialInput(habit, defaultCategory))
  const [selectedDate, setSelectedDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canEdit = !habit || habit.scope === 'shared' || habit.owner_user_id === userId
  const canComplete = !habit || habit.scope === 'shared' || habit.owner_user_id === userId

  const history = useMemo(() => snapshot.completions.filter((item) => item.habit_id === habit?.id && item.user_id === userId), [habit?.id, snapshot.completions, userId])
  const streak = snapshot.streaks.find((item) => item.habit_id === habit?.id)?.current_streak ?? 0
  const selectedSchedule = habit ? resolveSchedule(habit.id, selectedDate, snapshot.schedules) : undefined
  const existing = history.find((item) => selectedSchedule && item.schedule_version_id === selectedSchedule.id && item.interval_start === intervalStart(selectedSchedule, selectedDate))

  const saveMutation = useMutation({
    mutationFn: () => saveHabit(supabase, form),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['snapshot', userId] }); onClose() },
    onError: (reason) => setError((reason as Error).message),
  })
  const completionMutation = useMutation({
    mutationFn: () => logCompletion(supabase, habit!.id, selectedDate, note),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['snapshot', userId] })
      setSuccess(`Logged for ${formatDate(selectedDate)} · +${Number(result?.base_points_awarded ?? 0) + Number(result?.streak_bonus_awarded ?? 0)} points`)
    },
    onError: (reason) => setError((reason as Error).message),
  })

  const submit = (event: FormEvent) => { event.preventDefault(); setError(''); saveMutation.mutate() }
  const set = <K extends keyof HabitInput>(key: K, value: HabitInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const disabledDate = (date: string) => {
    if (!habit || date > today) return true
    const schedule = resolveSchedule(habit.id, date, snapshot.schedules)
    if (!schedule || !isScheduledDate(schedule, date)) return true
    return history.some((item) => item.schedule_version_id === schedule.id && item.interval_start === intervalStart(schedule, date))
  }

  return <Modal open={open} onClose={onClose} title={habit ? habit.name : 'Add a new habit'} description={habit ? 'History, past entries, and every editable field live together here.' : 'Create a small, clear action you can return to consistently.'} size="lg">
    <div className={`grid gap-6 ${habit ? 'lg:grid-cols-[1.05fr_.95fr]' : ''}`}>
      <form className="rounded-[26px] bg-white p-5 shadow-soft" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="habit-name">Name</Label><input id="habit-name" className={inputClass} required maxLength={100} disabled={!canEdit} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder={form.type === 'avoid' ? 'No late-night snacks' : 'Morning stretch'} /></div>
          <div><Label htmlFor="habit-icon">Icon</Label><div className="flex gap-2"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface/50 text-action"><AppIcon name={form.icon} /></span><select id="habit-icon" className={inputClass} disabled={!canEdit} value={form.icon} onChange={(event) => set('icon', event.target.value)}>{iconNames.map((name) => <option key={name}>{name}</option>)}</select></div></div>
          <div><Label htmlFor="habit-category">Category</Label><select id="habit-category" className={inputClass} disabled={!canEdit} value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)}>{snapshot.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div><Label htmlFor="habit-type">Type</Label><select id="habit-type" className={inputClass} disabled={!canEdit} value={form.type} onChange={(event) => set('type', event.target.value as HabitType)}><option value="build">Build — do the thing</option><option value="avoid">Avoid — stay clean</option></select></div>
          <div><Label htmlFor="habit-scope">Scope</Label><select id="habit-scope" className={inputClass} disabled={!canEdit} value={form.scope} onChange={(event) => set('scope', event.target.value as HabitScope)}><option value="personal">Personal</option><option value="shared">Shared</option></select></div>
          <div><Label htmlFor="habit-frequency">Frequency</Label><select id="habit-frequency" className={inputClass} disabled={!canEdit} value={form.frequency} onChange={(event) => set('frequency', event.target.value as HabitFrequency)}><option value="daily">Daily</option><option value="weekly">Once a week</option><option value="custom_days">Custom weekdays</option></select></div>
          <div><Label htmlFor="habit-size">Size</Label><select id="habit-size" className={inputClass} disabled={!canEdit} value={form.size} onChange={(event) => set('size', event.target.value as HabitSize)}><option value="small">Small · 1 point</option><option value="medium">Medium · 2 points</option><option value="large">Large · 3 points</option></select></div>
          {form.frequency === 'custom_days' && <fieldset className="sm:col-span-2"><legend className="mb-2 text-xs font-extrabold uppercase tracking-[0.09em] text-ink/55">Scheduled days</legend><div className="grid grid-cols-7 gap-1.5">{weekdays.map((day) => <label key={day.value} className={`cursor-pointer rounded-xl px-1 py-2 text-center text-xs font-black ${form.customDays.includes(day.value) ? 'bg-action text-white' : 'bg-app-bg text-ink/40'}`}><input className="sr-only" type="checkbox" disabled={!canEdit} checked={form.customDays.includes(day.value)} onChange={() => set('customDays', form.customDays.includes(day.value) ? form.customDays.filter((value) => value !== day.value) : [...form.customDays, day.value].sort())} />{day.label}</label>)}</div></fieldset>}
          {habit && <label className="sm:col-span-2 flex items-center justify-between rounded-2xl bg-app-bg px-4 py-3"><span><span className="flex items-center gap-2 font-black"><Archive size={17} /> Archive habit</span><span className="mt-1 block text-xs text-ink/45">Hidden from daily views; history remains intact.</span></span><input type="checkbox" className="size-5 accent-action" disabled={!canEdit} checked={form.archived} onChange={(event) => set('archived', event.target.checked)} /></label>}
        </div>
        {error && <div className="mt-4"><Notice>{error}</Notice></div>}
        {canEdit && <Button type="submit" className="mt-5 w-full" disabled={!form.name.trim() || !form.categoryId || (form.frequency === 'custom_days' && form.customDays.length === 0) || saveMutation.isPending}><Save size={17} /> {saveMutation.isPending ? 'Saving…' : habit ? 'Save habit' : 'Create habit'}</Button>}
      </form>

      {habit && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><div className="rounded-3xl bg-ink p-4 text-white"><p className="text-[10px] font-black uppercase tracking-wider text-white/50">Current streak</p><p className="mt-2 flex items-center gap-2 text-3xl font-black"><Flame className="text-accent" fill="currentColor" /> {streak}</p></div><div className="rounded-3xl bg-surface p-4"><p className="text-[10px] font-black uppercase tracking-wider text-ink/45">Completions</p><p className="mt-2 text-3xl font-black">{history.length}</p></div></div>
        <div className="rounded-[26px] bg-white p-4 shadow-soft"><MonthCalendar dates={history.map((item) => item.date)} initialDate={today} selectedDate={selectedDate} onSelect={setSelectedDate} disabledDate={disabledDate} /></div>
        <div className="rounded-[26px] bg-white p-4 shadow-soft"><div className="mb-3 flex items-center gap-2"><CalendarCheck className="text-action" size={18} /><h3 className="font-black">Log {formatDate(selectedDate)}</h3></div>{canComplete ? <><Label htmlFor="completion-note">Note (optional)</Label><textarea id="completion-note" className={`${inputClass} min-h-20 resize-none`} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="A little context for future you…" />{success && <div className="mt-3"><Notice tone="success">{success}</Notice></div>}<Button className="mt-3 w-full" variant="accent" disabled={completionMutation.isPending || Boolean(existing) || disabledDate(selectedDate)} onClick={() => { setError(''); setSuccess(''); completionMutation.mutate() }}><Check size={17} /> {completionMutation.isPending ? 'Logging…' : habit.type === 'avoid' ? 'Stayed clean' : 'Log completion'}</Button></> : <p className="text-sm leading-6 text-ink/50">This is your partner’s personal habit. You can cheer it on, but only they can log or edit it.</p>}</div>
      </div>}
    </div>
  </Modal>
}

export function HabitModal(props: HabitModalProps) {
  if (!props.open) return null
  return <HabitModalContent key={`${props.habit?.id ?? 'new'}-${props.initialCategoryId ?? ''}`} {...props} />
}
