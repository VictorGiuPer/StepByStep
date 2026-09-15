import { Check, Flame } from 'lucide-react'
import type { Category, Habit } from '@/types'
import { AppIcon } from './AppIcon'
import { Button } from './ui'

export function HabitCard({ habit, category, streak, completed, busy, onComplete, onUndo }: { habit: Habit; category?: Category; streak: number; completed: boolean; busy?: boolean; onComplete: () => void; onUndo?: () => void }) {
  return <article className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition ${completed ? 'border-emerald-100 bg-emerald-50/70' : 'border-white/80 bg-white shadow-soft'}`}>
    <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: category?.color || '#758BFD' }}><AppIcon name={habit.icon} size={19} /></span>
    <div className="min-w-0 flex-1"><p className={`truncate text-sm font-black ${completed ? 'text-ink/45 line-through' : ''}`}>{habit.name}</p><p className="mt-0.5 flex items-center gap-2 text-[11px] font-bold text-ink/45"><span>{category?.name}</span><span className="inline-flex items-center gap-1 text-accent"><Flame size={12} fill="currentColor" />{streak}</span><span>+{habit.base_points}</span></p></div>
    {completed ? <Button variant="secondary" size="icon" onClick={onUndo} disabled={busy || !onUndo} aria-label={`Undo ${habit.name} completion`} title="Undo today's completion"><Check size={20} strokeWidth={3} /></Button> : <Button size="icon" onClick={onComplete} disabled={busy} aria-label={habit.type === 'avoid' ? `Mark ${habit.name} as stayed clean` : `Complete ${habit.name}`}><Check size={20} strokeWidth={3} /></Button>}
  </article>
}
