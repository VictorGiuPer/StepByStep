import { useEffect, useState, type PropsWithChildren } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Home, LogOut, Settings, Shapes, Sparkles, WifiOff } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthProvider'
import { supabase } from '@/lib/supabase'
import type { AppSnapshot } from '@/types'
import { Avatar, Button, inputClass, Label, Modal, Notice } from './ui'

const navItems = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/categories', label: 'Manage', icon: Shapes },
  { to: '/stats', label: 'Stats + Shop', icon: BarChart3 },
]

export function AppShell({ snapshot, children, demoUserId }: PropsWithChildren<{ snapshot: AppSnapshot; demoUserId?: string }>) {
  const { user, signOut } = useAuth()
  const queryClient = useQueryClient()
  const effectiveUserId = user?.id ?? demoUserId
  const profile = snapshot.profiles.find((item) => item.id === effectiveUserId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '')
  const [timezone, setTimezone] = useState(snapshot.settings.timezone)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!effectiveUserId || demoUserId) return
      const [profileResult, settingsResult] = await Promise.all([
        supabase.from('profiles').update({ display_name: displayName.trim(), avatar_url: avatarUrl.trim() || null }).eq('id', effectiveUserId),
        supabase.from('app_settings').update({ timezone: timezone.trim() }).eq('id', 1),
      ])
      if (profileResult.error) throw profileResult.error
      if (settingsResult.error) throw settingsResult.error
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['snapshot', effectiveUserId] }); setSettingsOpen(false) },
    onError: (error) => setFormError((error as Error).message),
  })

  return <div className="min-h-screen bg-app-bg text-ink">
    {!online && <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-ink px-3 py-2 text-xs font-bold text-white"><WifiOff size={14} /> You’re offline. Viewing cached UI only; changes are paused.</div>}
    <header className={clsx('sticky z-30 border-b border-white/75 bg-app-bg/90 backdrop-blur-xl', online ? 'top-0' : 'top-8')}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-accent text-white shadow-accent"><Sparkles size={21} strokeWidth={2.5} /></span><div className="hidden sm:block"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-action">Nadine & Victor</p><p className="font-black tracking-tight">StepByStep</p></div></div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="rounded-2xl bg-white px-3.5 py-2 shadow-soft sm:px-4"><p className="text-[9px] font-black uppercase tracking-wider text-ink/40">Balance</p><p className="text-base font-black text-accent sm:text-lg">{snapshot.balance} pts</p></div>
          <Button variant="ghost" className="gap-2 px-2 sm:px-3" onClick={() => { setDisplayName(profile?.display_name ?? ''); setAvatarUrl(profile?.avatar_url ?? ''); setTimezone(snapshot.settings.timezone); setFormError(''); setSettingsOpen(true) }}><Avatar name={profile?.display_name ?? 'P'} url={profile?.avatar_url} size="sm" /><span className="hidden text-sm sm:inline">{profile?.display_name}</span><Settings size={16} className="hidden sm:block" /></Button>
        </div>
      </div>
    </header>

    <aside className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-md rounded-[24px] border border-white/80 bg-white/95 p-2 shadow-nav backdrop-blur-xl lg:bottom-auto lg:left-6 lg:right-auto lg:top-1/2 lg:w-24 lg:-translate-y-1/2">
      <nav className="flex justify-around lg:flex-col lg:gap-2">
        {navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx('flex min-w-16 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-extrabold transition lg:py-3', isActive ? 'bg-action text-white shadow-action' : 'text-ink/45 hover:bg-app-bg hover:text-ink')}><Icon size={20} /><span>{label}</span></NavLink>)}
      </nav>
    </aside>

    <main className="mx-auto max-w-7xl px-5 pb-28 pt-7 lg:px-8 lg:pl-32">{children}</main>

    <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Your settings" description="Profile details are visible only to the two of you." size="sm">
      <div className="space-y-4">
        <div><Label htmlFor="display-name">Display name</Label><input id="display-name" className={inputClass} maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
        <div><Label htmlFor="avatar-url">Avatar URL (optional)</Label><input id="avatar-url" type="url" className={inputClass} placeholder="https://…" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} /></div>
        <div><Label htmlFor="timezone">Household timezone</Label><input id="timezone" className={inputClass} value={timezone} onChange={(event) => setTimezone(event.target.value)} /><p className="mt-1.5 text-xs leading-5 text-ink/45">Use an IANA timezone such as Europe/Brussels. This controls “today” and Monday–Sunday week boundaries.</p></div>
        {formError && <Notice>{formError}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between"><Button variant="ghost" onClick={() => { if (demoUserId) window.location.href = window.location.pathname; else void signOut() }}><LogOut size={17} /> {demoUserId ? 'Exit preview' : 'Sign out'}</Button><Button disabled={Boolean(demoUserId) || !displayName.trim() || !timezone.trim() || saveSettings.isPending} onClick={() => { setFormError(''); saveSettings.mutate() }}>{demoUserId ? 'Preview only' : saveSettings.isPending ? 'Saving…' : 'Save settings'}</Button></div>
      </div>
    </Modal>
  </div>
}
