import { useState, type FormEvent } from 'react'
import { ArrowRight, Flame, Heart, LockKeyhole, Mail, Sparkles } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Button, inputClass, Label, Notice } from '@/components/ui'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try { await signIn(email, password) } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }

  return <main className="relative grid min-h-screen overflow-hidden bg-app-bg lg:grid-cols-[1.08fr_.92fr]">
    <div className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-surface/50 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-40 right-1/4 size-[30rem] rounded-full bg-action/15 blur-3xl" />
    <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex xl:p-16">
      <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-accent"><Sparkles /></span><div><p className="text-xs font-black uppercase tracking-[0.18em] text-white/55">Nadine & Victor</p><p className="text-xl font-black">StepByStep</p></div></div>
      <div className="max-w-xl">
        <div className="mb-8 flex items-center gap-3"><span className="grid size-14 place-items-center rounded-3xl bg-white/10"><Heart className="text-accent" fill="currentColor" /></span><span className="grid size-14 place-items-center rounded-3xl bg-white/10"><Flame className="text-accent" fill="currentColor" /></span></div>
        <h1 className="text-5xl font-black leading-[1.03] tracking-[-0.055em] xl:text-6xl">Small steps.<br />Shared joy.</h1>
        <p className="mt-6 max-w-md text-lg leading-8 text-white/65">Build your own rhythm, cheer each other on, and turn steady progress into rewards worth sharing.</p>
      </div>
      <p className="text-sm font-semibold text-white/35">Made for two. No feeds, followers, or pressure.</p>
    </section>
    <section className="relative flex items-center justify-center px-5 py-10 sm:px-10">
      <div className="w-full max-w-md">
        <div className="mb-9 lg:hidden"><span className="grid size-12 place-items-center rounded-2xl bg-accent text-white shadow-accent"><Sparkles /></span><h1 className="mt-5 text-3xl font-black tracking-tight">StepByStep</h1><p className="mt-1 text-sm font-bold text-action">by Nadine and Victor</p></div>
        <div className="rounded-[32px] bg-white p-6 shadow-nav sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-action">Welcome back</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Your rhythm is waiting.</h2>
          <p className="mt-2 text-sm leading-6 text-ink/55">Sign in with one of the two private partner accounts.</p>
          <form className="mt-7 space-y-4" onSubmit={submit}>
            <div><Label htmlFor="email">Email</Label><div className="relative"><Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30" size={18} /><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputClass} pl-11`} placeholder="you@example.com" /></div></div>
            <div><Label htmlFor="password">Password</Label><div className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30" size={18} /><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pl-11`} placeholder="••••••••" /></div></div>
            {!isSupabaseConfigured && <Notice>Supabase environment variables are missing.</Notice>}
            {error && <Notice>{error}</Notice>}
            <Button type="submit" disabled={busy || !isSupabaseConfigured} className="w-full" variant="accent">{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} /></Button>
          </form>
          <p className="mt-5 text-center text-xs font-semibold leading-5 text-ink/40">Accounts are created privately in Supabase.<br />There is no public sign-up.</p>
        </div>
      </div>
    </section>
  </main>
}
