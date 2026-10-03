import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Heart, LockKeyhole, Mail, Sparkles, X } from 'lucide-react'
import type { OAuthAuthorizationDetails } from '@supabase/auth-js'
import { Button, Card, inputClass, Label, Notice, Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'

const authId = new URLSearchParams(window.location.search).get('authorization_id')

export function OAuthConsentPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadAuthorization = async () => {
    if (!authId) {
      setError('This authorization link is missing its request ID. Return to ChatGPT and reconnect.')
      setLoading(false)
      return
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) {
      setError(sessionError.message)
      setLoading(false)
      return
    }
    if (!sessionData.session) {
      setUserEmail(null)
      setDetails(null)
      setLoading(false)
      return
    }

    setUserEmail(sessionData.session.user.email ?? 'Signed-in account')
    const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(authId)
    if (detailsError) {
      setError(detailsError.message)
      setLoading(false)
      return
    }
    if ('redirect_url' in data) {
      window.location.assign(data.redirect_url)
      return
    }
    setDetails(data)
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAuthorization() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) {
      setError(signInError.message)
      setBusy(false)
      return
    }
    await loadAuthorization()
    setBusy(false)
  }

  const decide = async (decision: 'approve' | 'deny') => {
    if (!authId) return
    setBusy(true)
    setError('')
    const result = decision === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authId)
      : await supabase.auth.oauth.denyAuthorization(authId)
    if (result.error) {
      setError(result.error.message)
      setBusy(false)
      return
    }
    window.location.assign(result.data.redirect_url)
  }

  const scopes = details?.scope.split(' ').filter(Boolean) ?? []

  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-app-bg p-5">
    <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-surface/50 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-32 -right-20 size-96 rounded-full bg-action/15 blur-3xl" />
    <Card className="relative w-full max-w-lg p-6 sm:p-9">
      <div className="mb-7 flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-accent text-white"><Heart fill="currentColor" /></span>
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-action">Nadine & Victor</p><h1 className="text-xl font-black">StepByStep</h1></div>
      </div>

      {loading ? <div className="py-8"><Spinner label="Checking your connection…" /></div> : error && !details ? <Notice>{error}</Notice> : !userEmail ? <>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-action">Secure sign-in</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight">Connect your tracker to ChatGPT</h2>
        <p className="mt-2 text-sm leading-6 text-ink/60">Sign in with your existing StepByStep partner account. This doesn’t create a new account.</p>
        <form className="mt-6 space-y-4" onSubmit={signIn}>
          <div><Label htmlFor="oauth-email">Email</Label><div className="relative"><Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30" size={18} /><input id="oauth-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputClass} pl-11`} /></div></div>
          <div><Label htmlFor="oauth-password">Password</Label><div className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30" size={18} /><input id="oauth-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pl-11`} /></div></div>
          {error && <Notice>{error}</Notice>}
          <Button type="submit" disabled={busy} className="w-full" variant="accent">{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} /></Button>
        </form>
      </> : details ? <>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-action">Permission request</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight">Allow {details.client.name} to connect?</h2>
        <p className="mt-2 text-sm leading-6 text-ink/60">Signed in as <span className="font-bold text-ink">{userEmail}</span>. This connection can access your StepByStep account through the tools listed below.</p>
        <div className="mt-5 rounded-2xl bg-app-bg p-4">
          <p className="text-sm font-black">Available actions</p>
          <ul className="mt-2 space-y-2 text-sm leading-5 text-ink/65">
            <li className="flex gap-2"><Check className="mt-0.5 shrink-0 text-action" size={16} />Read your available task categories</li>
            <li className="flex gap-2"><Check className="mt-0.5 shrink-0 text-action" size={16} />Add a personal or shared to-do when you approve the action in ChatGPT</li>
          </ul>
          {scopes.length > 0 && <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-ink/45">Sign-in permissions: {scopes.join(', ')}</p>}
        </div>
        <p className="mt-4 text-xs leading-5 text-ink/45">You can disconnect this connection from ChatGPT at any time. Adding a task changes your tracker; ChatGPT will ask you to approve that action.</p>
        {error && <div className="mt-4"><Notice>{error}</Notice></div>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('deny')}><X size={16} /> Decline</Button>
          <Button type="button" variant="accent" disabled={busy} onClick={() => void decide('approve')}><Sparkles size={16} /> {busy ? 'Connecting…' : 'Allow access'}</Button>
        </div>
      </> : <Notice>{error || 'Could not load the permission request. Return to ChatGPT and try connecting again.'}</Notice>}
    </Card>
  </main>
}
