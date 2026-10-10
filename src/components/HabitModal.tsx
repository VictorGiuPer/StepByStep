import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, Flame, Save, Trash2 } from 'lucide-react'
import { friendlyError, saveHabit } from '@/lib/points'
import { categoryLabel } from '@/lib/categories'
import { supabase } from '@/lib/supabase'
import { isDemoMode } from '@/lib/demo'
import type { AppSnapshot, Habit, HabitFrequency, HabitInput, HabitScope, HabitSize, HabitType } from '@/types'
import { AppIcon, iconNames } from './AppIcon'
import { Button, inputClass, Label, Modal, Notice } from './ui'

const weekdays = [{ value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 7, label: 'Sun' }]

function initialInput(habit: Habit | null, categoryId: string): HabitInput {
  return habit ? {
    id: habit.id, name: habit.name, icon: habit.icon, categoryId: habit.category_id, type: habit.type,
    scope: habit.scope, frequency: habit.weekly_target ? 'flexible_weekly' : habit.frequency === 'daily' || habit.frequency === 'weekly' ? 'custom_days' : habit.frequency, customDays: habit.frequency === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : habit.frequency === 'weekly' ? [] : habit.custom_days ?? [], size: habit.size, archived: habit.archived, weeklyTarget: habit.weekly_target ?? 3,
  } : { name: '', icon: 'Sparkles', categoryId, type: 'build', scope: 'personal', frequency: 'custom_days', customDays: [1, 3, 5], size: 'small', archived: false, weeklyTarget: 3 }
}

interface HabitModalProps { open: boolean; onClose: () => void; habit: Habit | null; snapshot: AppSnapshot; userId: string; initialCategoryId?: string }

function HabitModalContent({ open, onClose, habit, snapshot, userId, initialCategoryId }: HabitModalProps) {
  const queryClient = useQueryClient()
  const defaultCategory = habit?.category_id ?? initialCategoryId ?? snapshot.categories[0]?.id ?? ''
  const [form, setForm] = useState<HabitInput>(() => initialInput(habit, defaultCategory))
  const [error, setError] = useState('')
  const canEdit = !habit || habit.scope === 'shared' || habit.owner_user_id === userId

  const history = useMemo(() => snapshot.completions.filter((item) => item.habit_id === habit?.id && item.user_id === userId && !item.voided_at), [habit?.id, snapshot.completions, userId])
  const streak = snapshot.streaks.find((item) => item.habit_id === habit?.id && item.user_id === userId)?.current_streak ?? 0

  const saveMutation = useMutation({
    mutationFn: () => saveHabit(supabase, form),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['snapshot', userId] }); onClose() },
    onError: (reason) => setError((reason as Error).message),
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (isDemoMode) return
      const { error: rpcError } = await supabase.rpc('delete_habit', { p_habit_id: habit!.id })
      if (rpcError) throw friendlyError(rpcError)
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['snapshot', userId] }); onClose() },
    onError: (reason) => setError((reason as Error).message),
  })
  const submit = (event: FormEvent) => { event.preventDefault(); setError(''); saveMutation.mutate() }
  const set = <K extends keyof HabitInput>(key: K, value: HabitInput[K]) => setForm((current) => ({ ...current, [key]: value }))

  return <Modal open={open} onClose={onClose} title={habit ? habit.name : 'Add a new habit'} description={habit ? 'Keep the routine simple and adjust what matters.' : 'Create a small, clear action you can return to consistently.'} size="lg">
    <div className="mx-auto max-w-2xl">
      <form className="rounded-[26px] bg-white p-5 shadow-soft" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="habit-name">Name</Label><input id="habit-name" className={inputClass} required maxLength={100} disabled={!canEdit} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder={form.type === 'avoid' ? 'No late-night snacks' : 'Morning stretch'} /></div>
          <div><Label htmlFor="habit-icon">Icon</Label><div className="flex gap-2"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface/50 text-action"><AppIcon name={form.icon} /></span><select id="habit-icon" className={inputClass} disabled={!canEdit} value={form.icon} onChange={(event) => set('icon', event.target.value)}>{iconNames.map((name) => <option key={name}>{name}</option>)}</select></div></div>
          <div><Label htmlFor="habit-category">Category</Label><select id="habit-category" className={inputClass} disabled={!canEdit} value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)}>{snapshot.categories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category)}</option>)}</select></div>
          <div><Label htmlFor="habit-type">Type</Label><select id="habit-type" className={inputClass} disabled={!canEdit} value={form.type} onChange={(event) => set('type', event.target.value as HabitType)}><option value="build">Build — do the thing</option><option value="avoid">Avoid — stay clean</option></select></div>
          <div><Label htmlFor="habit-scope">Scope</Label><select id="habit-scope" className={inputClass} disabled={!canEdit} value={form.scope} onChange={(event) => set('scope', event.target.value as HabitScope)}><option value="personal">Personal</option><option value="shared">Shared</option></select></div>
          <div><Label htmlFor="habit-frequency">Schedule</Label><select id="habit-frequency" className={inputClass} disabled={!canEdit} value={form.frequency} onChange={(event) => set('frequency', event.target.value as HabitFrequency)}><option value="custom_days">Choose days</option><option value="flexible_weekly">Flexible weekly target</option></select></div>
          <div><Label htmlFor="habit-size">Size</Label><select id="habit-size" className={inputClass} disabled={!canEdit} value={form.size} onChange={(event) => set('size', event.target.value as HabitSize)}><option value="small">Small · 1 point</option><option value="medium">Medium · 2 points</option><option value="large">Large · 3 points</option></select></div>
          {form.frequency === 'custom_days' && <fieldset className="sm:col-span-2"><legend className="mb-2 flex items-center justify-between text-xs font-extrabold uppercase tracking-[0.09em] text-ink/55"><span>Choose your days</span><span className="normal-case tracking-normal text-action">{form.customDays.length === 7 ? 'Daily' : `${form.customDays.length} ${form.customDays.length === 1 ? 'day' : 'days'} per week`}</span></legend><p className="mb-2 text-xs leading-5 text-ink/45">Pick any combination, including all seven days for a daily habit. You can adjust this whenever you like.</p>{habit?.frequency === 'weekly' && <p className="mb-2 text-xs font-bold text-accent">Choose the days for this existing weekly habit to set its new schedule.</p>}<div className="grid grid-cols-7 gap-1.5">{weekdays.map((day) => <label key={day.value} className={`cursor-pointer rounded-xl px-1 py-2 text-center text-xs font-black ${form.customDays.includes(day.value) ? 'bg-action text-white' : 'bg-app-bg text-ink/40'}`}><input className="sr-only" type="checkbox" disabled={!canEdit} checked={form.customDays.includes(day.value)} onChange={() => set('customDays', form.customDays.includes(day.value) ? form.customDays.filter((value) => value !== day.value) : [...form.customDays, day.value].sort())} />{day.label}</label>)}</div></fieldset>}
          {form.frequency === 'flexible_weekly' && <div className="sm:col-span-2"><Label htmlFor="habit-weekly-target">Times per week</Label><input id="habit-weekly-target" className={inputClass} type="number" min="1" max="7" disabled={!canEdit} value={form.weeklyTarget ?? 3} onChange={(event) => set('weeklyTarget', Number(event.target.value) || null)} /><p className="mt-1 text-xs leading-5 text-ink/45">It appears once on Today with a + / − counter, so you can do it on whichever days work.</p></div>}
          {habit && <label className="sm:col-span-2 flex items-center justify-between rounded-2xl bg-app-bg px-4 py-3"><span><span className="flex items-center gap-2 font-black"><Archive size={17} /> Archive habit</span><span className="mt-1 block text-xs text-ink/45">Hidden from daily views; history remains intact.</span></span><input type="checkbox" className="size-5 accent-action" disabled={!canEdit} checked={form.archived} onChange={(event) => set('archived', event.target.checked)} /></label>}
        </div>
        {error && <div className="mt-4"><Notice>{error}</Notice></div>}
        {canEdit && habit && <Button type="button" variant="danger" className="mt-5 w-full" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}><Trash2 size={17} /> {deleteMutation.isPending ? 'Deleting…' : 'Delete habit'}</Button>}
        {canEdit && <Button type="submit" className="mt-2 w-full" disabled={!form.name.trim() || !form.categoryId || (form.frequency === 'custom_days' && form.customDays.length === 0) || (form.frequency === 'flexible_weekly' && (!form.weeklyTarget || form.weeklyTarget < 1 || form.weeklyTarget > 7)) || saveMutation.isPending}><Save size={17} /> {saveMutation.isPending ? 'Saving…' : habit ? 'Save habit' : 'Create habit'}</Button>}
        {habit && <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-3xl bg-ink p-4 text-white"><p className="text-[10px] font-black uppercase tracking-wider text-white/50">Current streak</p><p className="mt-2 flex items-center gap-2 text-3xl font-black"><Flame className="text-accent" fill="currentColor" /> {streak}</p></div><div className="rounded-3xl bg-surface p-4"><p className="text-[10px] font-black uppercase tracking-wider text-ink/45">Completions</p><p className="mt-2 text-3xl font-black">{history.length}</p></div></div>}
      </form>
    </div>
  </Modal>
}

export function HabitModal(props: HabitModalProps) {
  if (!props.open) return null
  return <HabitModalContent key={`${props.habit?.id ?? 'new'}-${props.initialCategoryId ?? ''}`} {...props} />
}
