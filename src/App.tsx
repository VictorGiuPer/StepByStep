import { lazy, Suspense, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { AppShell } from '@/components/AppShell'
import { HabitModal } from '@/components/HabitModal'
import { Button, Notice, Spinner } from '@/components/ui'
import { useAppSnapshot, useRealtimeRefresh } from '@/lib/api'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'

const CategoriesPage = lazy(() => import('@/pages/CategoriesPage').then((module) => ({ default: module.CategoriesPage })))
const StatsShopPage = lazy(() => import('@/pages/StatsShopPage').then((module) => ({ default: module.StatsShopPage })))

function BrandedLoader() {
  return <div className="grid min-h-screen place-items-center bg-app-bg"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-3xl bg-accent text-white shadow-accent"><Sparkles /></span><Spinner label="Finding your rhythm…" /></div></div>
}

function AuthenticatedApp({ userId }: { userId: string }) {
  const { data: snapshot, isLoading, error, refetch } = useAppSnapshot(userId)
  const [addHabit, setAddHabit] = useState(false)
  useRealtimeRefresh(userId)
  if (isLoading) return <BrandedLoader />
  if (error || !snapshot) return <div className="grid min-h-screen place-items-center bg-app-bg p-5"><div className="w-full max-w-md rounded-[30px] bg-white p-6 shadow-nav"><span className="grid size-12 place-items-center rounded-2xl bg-accent text-white"><Sparkles /></span><h1 className="mt-5 text-2xl font-black">The app is ready for its database.</h1><p className="mt-2 text-sm leading-6 text-ink/55">Apply the included Supabase migrations to the linked project, then create and confirm the two partner accounts.</p><div className="mt-4"><Notice>{(error as Error)?.message || 'Could not load StepByStep data.'}</Notice></div><Button className="mt-4 w-full" onClick={() => void refetch()}>Try again</Button></div></div>
  return <AppShell snapshot={snapshot}><Suspense fallback={<Spinner label="Opening this space…" />}><Routes><Route path="/" element={<DashboardPage snapshot={snapshot} userId={userId} onAddHabit={() => setAddHabit(true)} />} /><Route path="/categories" element={<CategoriesPage snapshot={snapshot} userId={userId} />} /><Route path="/stats" element={<StatsShopPage snapshot={snapshot} userId={userId} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense><HabitModal open={addHabit} onClose={() => setAddHabit(false)} habit={null} snapshot={snapshot} userId={userId} /></AppShell>
}

function AppGate() {
  const { user, loading } = useAuth()
  if (loading) return <BrandedLoader />
  return user ? <AuthenticatedApp userId={user.id} /> : <LoginPage />
}

export function App() {
  return <HashRouter><AuthProvider><AppGate /></AuthProvider></HashRouter>
}
