import { useState, type FormEvent } from 'react'
import { KeyRound, Sparkles } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Button, inputClass, Label, Notice, Spinner } from '@/components/ui'

export function RecoveryPage() {
  const { session, loading, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError('The passwords do not match.'); return }
    setBusy(true)
    try { await updatePassword(password); setComplete(true) } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  if (loading) return <div className="grid min-h-screen place-items-center bg-app-bg"><Spinner label="Opening password recovery…" /></div>
  if (!session) return <main className="grid min-h-screen place-items-center bg-app-bg p-5"><div className="w-full max-w-md rounded-[32px] bg-white p-7 text-center shadow-nav"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent text-white"><KeyRound /></span><h1 className="mt-5 text-2xl font-black">That link has expired.</h1><p className="mt-2 text-sm leading-6 text-ink/55">Request a fresh password recovery email from Supabase, then open it in this browser.</p></div></main>
  if (complete) return <main className="grid min-h-screen place-items-center bg-app-bg p-5"><div className="w-full max-w-md rounded-[32px] bg-white p-7 text-center shadow-nav"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent text-white"><Sparkles /></span><h1 className="mt-5 text-2xl font-black">Password updated.</h1><p className="mt-2 text-sm leading-6 text-ink/55">You can now return to StepByStep.</p><Button className="mt-5" variant="accent" onClick={() => { window.location.href = window.location.pathname }}>Continue</Button></div></main>
  return <main className="grid min-h-screen place-items-center bg-app-bg p-5"><div className="w-full max-w-md rounded-[32px] bg-white p-7 shadow-nav"><span className="grid size-12 place-items-center rounded-2xl bg-accent text-white"><KeyRound /></span><p className="mt-5 text-xs font-black uppercase tracking-[0.16em] text-action">Password recovery</p><h1 className="mt-2 text-3xl font-black tracking-tight">Choose a new password.</h1><p className="mt-2 text-sm leading-6 text-ink/55">This link is private and works only for the account that requested it.</p><form className="mt-6 space-y-4" onSubmit={submit}><div><Label htmlFor="new-password">New password</Label><input id="new-password" className={inputClass} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div><div><Label htmlFor="confirm-password">Confirm password</Label><input id="confirm-password" className={inputClass} type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div>{error && <Notice>{error}</Notice>}<Button type="submit" className="w-full" variant="accent" disabled={busy}>{busy ? 'Updating…' : 'Save new password'}</Button></form></div></main>
}
