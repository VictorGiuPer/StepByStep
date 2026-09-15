import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type PropsWithChildren, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertCircle, Check, LoaderCircle, X } from 'lucide-react'

export function Button({ className, variant = 'primary', size = 'md', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'icon' }) {
  return <button className={clsx(
    'inline-flex items-center justify-center gap-2 rounded-2xl font-extrabold transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-action/25 disabled:cursor-not-allowed disabled:opacity-45',
    variant === 'primary' && 'bg-action text-white shadow-action hover:-translate-y-0.5 hover:bg-[#667df4]',
    variant === 'accent' && 'bg-accent text-white shadow-accent hover:-translate-y-0.5 hover:bg-[#eb7b00]',
    variant === 'secondary' && 'bg-surface/65 text-ink hover:bg-surface',
    variant === 'ghost' && 'bg-transparent text-ink/65 hover:bg-white/70 hover:text-ink',
    variant === 'danger' && 'bg-red-50 text-red-700 hover:bg-red-100',
    size === 'sm' && 'min-h-9 px-3 py-2 text-xs',
    size === 'md' && 'min-h-11 px-4 py-2.5 text-sm',
    size === 'icon' && 'size-11 p-0',
    className,
  )} {...props} />
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-[28px] bg-white p-5 shadow-soft sm:p-6', className)} {...props} />
}

export function Label({ children, htmlFor }: PropsWithChildren<{ htmlFor?: string }>) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.09em] text-ink/55">{children}</label>
}

export const inputClass = 'min-h-11 w-full rounded-2xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink outline-none transition placeholder:text-ink/30 focus:border-action focus:ring-4 focus:ring-action/15 disabled:bg-app-bg disabled:text-ink/40'

export function Modal({ open, onClose, title, description, children, size = 'md' }: PropsWithChildren<{ open: boolean; onClose: () => void; title: string; description?: string; size?: 'sm' | 'md' | 'lg' }>) {
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', close); document.body.style.overflow = '' }
  }, [onClose, open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/25 p-3 backdrop-blur-sm sm:place-items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className={clsx('dialog-in max-h-[91vh] w-full overflow-y-auto rounded-[32px] bg-app-bg p-5 shadow-nav sm:p-6', size === 'sm' && 'sm:max-w-md', size === 'md' && 'sm:max-w-2xl', size === 'lg' && 'sm:max-w-4xl')}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><h2 id="modal-title" className="text-2xl font-black tracking-tight">{title}</h2>{description && <p className="mt-1 text-sm leading-6 text-ink/55">{description}</p>}</div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X size={20} /></Button>
        </div>
        {children}
      </section>
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm font-bold text-ink/55"><LoaderCircle className="animate-spin text-action" /> {label}</div>
}

export function Notice({ tone = 'error', children }: PropsWithChildren<{ tone?: 'error' | 'success' }>) {
  return <div role="status" className={clsx('flex items-start gap-2 rounded-2xl px-3.5 py-3 text-sm font-semibold', tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800')}>
    {tone === 'error' ? <AlertCircle className="mt-0.5 shrink-0" size={17} /> : <Check className="mt-0.5 shrink-0" size={17} />}{children}
  </div>
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return <div className="rounded-3xl border border-dashed border-ink/15 bg-white/55 px-6 py-10 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface/45 text-action">{icon}</div><h3 className="mt-4 font-black">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-ink/55">{body}</p>{action && <div className="mt-4">{action}</div>}</div>
}

export function Avatar({ name, url, size = 'md' }: { name: string; url?: string | null; size?: 'sm' | 'md' }) {
  const classes = size === 'sm' ? 'size-9 text-xs' : 'size-11 text-sm'
  return url ? <img src={url} alt="" className={clsx(classes, 'rounded-2xl object-cover')} /> : <span className={clsx(classes, 'grid place-items-center rounded-2xl bg-surface font-black text-ink')}>{name.slice(0, 1).toUpperCase()}</span>
}
