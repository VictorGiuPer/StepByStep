import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDate, monthGrid, monthLabel, parseDateKey, toDateKey } from '@/lib/date'
import { Button } from './ui'

interface MonthCalendarProps {
  dates: string[]
  initialDate: string
  selectedDate?: string
  onSelect?: (date: string) => void
  disabledDate?: (date: string) => boolean
  compact?: boolean
}

export function MonthCalendar({ dates, initialDate, selectedDate, onSelect, disabledDate, compact }: MonthCalendarProps) {
  const [anchor, setAnchor] = useState(initialDate)
  const counts = useMemo(() => dates.reduce<Record<string, number>>((result, date) => ({ ...result, [date]: (result[date] ?? 0) + 1 }), {}), [dates])
  const cells = monthGrid(anchor)
  const moveMonth = (amount: number) => {
    const date = parseDateKey(anchor)
    date.setUTCMonth(date.getUTCMonth() + amount, 1)
    setAnchor(toDateKey(date))
  }

  return <div>
    <div className="mb-4 flex items-center justify-between">
      <Button variant="ghost" size="icon" type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></Button>
      <p className="font-black">{monthLabel(anchor)}</p>
      <Button variant="ghost" size="icon" type="button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={18} /></Button>
    </div>
    <div className="grid grid-cols-7 gap-1.5 text-center">
      {['M','T','W','T','F','S','S'].map((day, index) => <span key={`${day}-${index}`} className="pb-1 text-[10px] font-black text-ink/35">{day}</span>)}
      {cells.map(({ key, inMonth }) => {
        const disabled = disabledDate?.(key) ?? false
        const count = counts[key] ?? 0
        const content = <span className={clsx(
          'relative grid aspect-square place-items-center rounded-xl text-xs font-extrabold transition',
          !inMonth && 'opacity-25', disabled && 'cursor-not-allowed bg-transparent text-ink/20',
          !disabled && count === 0 && 'bg-app-bg text-ink/45',
          !disabled && count === 1 && 'bg-surface/80 text-ink',
          !disabled && count > 1 && 'bg-action text-white',
          selectedDate === key && 'ring-2 ring-accent ring-offset-2',
          onSelect && !disabled && 'hover:-translate-y-0.5 hover:shadow-soft',
          compact && 'rounded-lg text-[10px]',
        )}>{formatDate(key, { day: 'numeric' })}{count > 1 && <span className="absolute right-1 top-0.5 text-[8px]">{count}</span>}</span>
        return onSelect ? <button key={key} type="button" disabled={disabled} aria-label={formatDate(key, { day: 'numeric', month: 'long', year: 'numeric' })} onClick={() => onSelect(key)}>{content}</button> : <div key={key}>{content}</div>
      })}
    </div>
  </div>
}
