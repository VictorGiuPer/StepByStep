import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, Edit3, Plus, Shapes, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { dateKeyInTimeZone } from '@/lib/date'
import { friendlyError } from '@/lib/points'
import { supabase } from '@/lib/supabase'
import type { AppSnapshot, Category, Habit } from '@/types'
import { AppIcon, iconNames } from '@/components/AppIcon'
import { HabitCard } from '@/components/HabitCard'
import { HabitModal } from '@/components/HabitModal'
import { MonthCalendar } from '@/components/MonthCalendar'
import { Button, Card, EmptyState, inputClass, Label, Modal, Notice } from '@/components/ui'

interface CategoryModalProps { open: boolean; onClose: () => void; category: Category | null; snapshot: AppSnapshot; userId: string }

function CategoryModalContent({ open, onClose, category, snapshot, userId }: CategoryModalProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon ?? 'Shapes')
  const [color, setColor] = useState(category?.color ?? '#758BFD')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), icon, color, sort_order: category?.sort_order ?? Math.max(0, ...snapshot.categories.map((item) => item.sort_order)) + 1, ...(category ? {} : { created_by: userId }) }
      const result = category ? await supabase.from('categories').update(payload).eq('id', category.id) : await supabase.from('categories').insert(payload)
      if (result.error) throw friendlyError(result.error)
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['snapshot', userId] }); onClose() },
    onError: (reason) => setError((reason as Error).message),
  })
  const remove = useMutation({
    mutationFn: async () => { const { error: removeError } = await supabase.from('categories').delete().eq('id', category!.id); if (removeError) throw friendlyError(removeError) },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['snapshot', userId] }); onClose() },
    onError: (reason) => setError((reason as Error).message),
  })
  const submit = (event: FormEvent) => { event.preventDefault(); setError(''); mutation.mutate() }
  return <Modal open={open} onClose={onClose} title={category ? 'Edit category' : 'Add a category'} description="Categories stay database-driven, so your system can grow with you." size="sm"><form className="space-y-4" onSubmit={submit}><div><Label htmlFor="category-name">Name</Label><input id="category-name" className={inputClass} required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label htmlFor="category-icon">Icon</Label><div className="flex gap-2"><span className="grid size-11 shrink-0 place-items-center rounded-2xl text-white" style={{ backgroundColor: color }}><AppIcon name={icon} /></span><select id="category-icon" className={inputClass} value={icon} onChange={(event) => setIcon(event.target.value)}>{iconNames.map((item) => <option key={item}>{item}</option>)}</select></div></div><div><Label htmlFor="category-color">Color</Label><div className="flex gap-2"><input id="category-color" type="color" className="h-11 w-14 rounded-2xl border-0 bg-white p-1" value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} /><input className={inputClass} pattern="^#[0-9A-Fa-f]{6}$" value={color} onChange={(event) => setColor(event.target.value)} /></div></div>{error && <Notice>{error}</Notice>}<div className="flex gap-2 pt-2">{category && <Button type="button" variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}><Trash2 size={16} /> Delete</Button>}<Button type="submit" className="ml-auto" disabled={!name.trim() || mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save category'}</Button></div></form></Modal>
}

function CategoryModal(props: CategoryModalProps) {
  if (!props.open) return null
  return <CategoryModalContent key={props.category?.id ?? 'new'} {...props} />
}

export function CategoriesPage({ snapshot, userId }: { snapshot: AppSnapshot; userId: string }) {
  const today = dateKeyInTimeZone(snapshot.settings.timezone)
  const [selectedCategoryId, setSelectedCategoryId] = useState(snapshot.categories[0]?.id ?? '')
  const [categoryModal, setCategoryModal] = useState<Category | null | 'new'>(null)
  const [habitModal, setHabitModal] = useState<Habit | null | 'new'>(null)
  const [showArchived, setShowArchived] = useState(false)
  const activeCategoryId = snapshot.categories.some((item) => item.id === selectedCategoryId) ? selectedCategoryId : snapshot.categories[0]?.id ?? ''
  const selectedCategory = snapshot.categories.find((item) => item.id === activeCategoryId)
  const habits = snapshot.habits.filter((habit) => habit.category_id === activeCategoryId && (showArchived || !habit.archived))
  const categoryDates = useMemo(() => {
    const ids = new Set(snapshot.habits.filter((habit) => habit.category_id === activeCategoryId).map((habit) => habit.id))
    return snapshot.completions.filter((item) => item.user_id === userId && ids.has(item.habit_id)).map((item) => item.date)
  }, [activeCategoryId, snapshot.completions, snapshot.habits, userId])

  return <>
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-extrabold text-action">Shape your system</p><h1 className="mt-1 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Categories & habits</h1><p className="mt-2 text-sm leading-6 text-ink/55">Everything here is yours to rename, reorganize, and grow.</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setCategoryModal('new')}><Shapes size={17} /> Category</Button><Button variant="accent" onClick={() => setHabitModal('new')} disabled={!snapshot.categories.length}><Plus size={17} /> Habit</Button></div></div>
    {snapshot.categories.length ? <>
      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">{snapshot.categories.map((category) => <button key={category.id} onClick={() => setSelectedCategoryId(category.id)} className={clsx('flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-extrabold transition', activeCategoryId === category.id ? 'text-white shadow-action' : 'bg-white text-ink/50 hover:text-ink')} style={activeCategoryId === category.id ? { backgroundColor: category.color } : undefined}><AppIcon name={category.icon} size={17} /> {category.name}</button>)}</div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
        <section>
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl text-white" style={{ backgroundColor: selectedCategory?.color }}><AppIcon name={selectedCategory?.icon} /></span><div><h2 className="text-xl font-black">{selectedCategory?.name}</h2><p className="text-xs font-bold text-ink/40">{habits.length} {habits.length === 1 ? 'habit' : 'habits'}</p></div></div><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label="Edit category" onClick={() => selectedCategory && setCategoryModal(selectedCategory)}><Edit3 size={18} /></Button><Button variant={showArchived ? 'secondary' : 'ghost'} size="icon" aria-label="Toggle archived habits" onClick={() => setShowArchived((value) => !value)}><Archive size={18} /></Button></div></div>
          {habits.length ? <div className="space-y-3">{habits.map((habit) => <HabitCard key={habit.id} habit={habit} category={selectedCategory} streak={snapshot.streaks.find((item) => item.habit_id === habit.id)?.current_streak ?? 0} completed={false} onComplete={() => setHabitModal(habit)} onOpen={() => setHabitModal(habit)} />)}</div> : <EmptyState icon={<Plus />} title="No habits here yet" body="Add the first habit to this category, or switch on archived habits to see history." action={<Button onClick={() => setHabitModal('new')}>Add habit</Button>} />}
        </section>
        <Card><div className="mb-4"><p className="text-[10px] font-black uppercase tracking-wider text-ink/40">Category history</p><h2 className="mt-1 text-lg font-black">Your rhythm</h2></div><MonthCalendar dates={categoryDates} initialDate={today} /></Card>
      </div>
    </> : <EmptyState icon={<Shapes />} title="Create your first category" body="Categories are entirely database-driven. Add one here to start organizing your habits." action={<Button onClick={() => setCategoryModal('new')}>Add category</Button>} />}
    <CategoryModal open={categoryModal !== null} onClose={() => setCategoryModal(null)} category={categoryModal === 'new' ? null : categoryModal} snapshot={snapshot} userId={userId} />
    <HabitModal open={habitModal !== null} onClose={() => setHabitModal(null)} habit={habitModal === 'new' ? null : habitModal} snapshot={snapshot} userId={userId} initialCategoryId={activeCategoryId} />
  </>
}
