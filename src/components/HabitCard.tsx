import { Check, Flame, MoreHorizontal, ShieldCheck, Users } from 'lucide-react'
import type { Category, Habit } from '@/types'
import { AppIcon } from './AppIcon'
import { Button } from './ui'

export function HabitCard({ habit, category, streak, completed, busy, onComplete, onOpen }: { habit: Habit; category?: Category; streak: number; completed: boolean; busy?: boolean; onComplete: () => void; onOpen: () => void }) {
  return <article className={`group flex items-center gap-3 rounded-3xl border p-3.5 transition sm:gap-4 sm:p-4 ${completed ? 'border-emerald-100 bg-emerald-50/70' : 'border-white/80 bg-white shadow-soft hover:-translate-y-0.5'}`}>
    <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-white" style={{ backgroundColor: category?.color || '#758BFD' }}><AppIcon name={habit.icon} size={22} /></span>
      <span className="min-w-0 flex-1"><span className={`block truncate font-black ${completed ? 'text-ink/55 line-through' : ''}`}>{habit.name}</span><span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-ink/40"><span>{category?.name}</span><span className="inline-flex items-center gap-1">{habit.scope === 'shared' ? <Users size={12} /> : <ShieldCheck size={12} />}{habit.scope}</span><span>+{habit.base_points}</span></span></span>
    </button>
    <span className="hidden items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1.5 text-xs font-black text-accent sm:flex"><Flame size={14} fill="currentColor" /> {streak}</span>
    {completed ? <span className="grid size-11 place-items-center rounded-2xl bg-emerald-500 text-white"><Check size={20} strokeWidth={3} /></span> : <Button size="icon" onClick={onComplete} disabled={busy} aria-label={habit.type === 'avoid' ? `Mark ${habit.name} as stayed clean` : `Complete ${habit.name}`}><Check size={20} strokeWidth={3} /></Button>}
    <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={onOpen} aria-label={`Open ${habit.name}`}><MoreHorizontal size={19} /></Button>
  </article>
}
