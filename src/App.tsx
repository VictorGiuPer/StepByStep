import { lazy, Suspense, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { AppShell } from '@/components/AppShell'
import { Button, Notice, Spinner } from '@/components/ui'
import { useAppSnapshot, useRealtimeRefresh } from '@/lib/api'
import { createDemoSnapshot, DEMO_USER_ID, isDemoMode, previewComplete, previewDecideRedemption, previewRequestRedemption, previewUndoTodayCompletion } from '@/lib/demo'
import type { AppSnapshot } from '@/types'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { RecoveryPage } from '@/pages/RecoveryPage'

const CategoriesPage = lazy(() => import('@/pages/CategoriesPage').then((module) => ({ default: module.CategoriesPage })))
const StatsShopPage = lazy(() => import('@/pages/StatsShopPage').then((module) => ({ default: module.StatsShopPage })))

function BrandedLoader() {
  return <div className="grid min-h-screen place-items-center bg-app-bg"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-3xl bg-accent text-white shadow-accent"><Sparkles /></span><Spinner label="Finding your rhythm…" /></div></div>
}

function AppContent({ snapshot, userId, demoMode = false, onPreviewComplete, onPreviewUndo, onPreviewRequest, onPreviewDecision }: { snapshot: NonNullable<ReturnType<typeof useAppSnapshot>['data']>; userId: string; demoMode?: boolean; onPreviewComplete?: (habitId: string) => { base_points_awarded: number; streak_bonus_awarded: number }; onPreviewUndo?: (habitId: string) => void; onPreviewRequest?: (rewardId: string) => void; onPreviewDecision?: (redemptionId: string, decision: 'confirmed' | 'declined', reason?: string) => void }) {
  return <AppShell snapshot={snapshot} demoUserId={demoMode ? userId : undefined}><Suspense fallback={<Spinner label="Opening this space…" />}>{demoMode && <Notice tone="success">Local preview mode — changes stay in this browser only.</Notice>}<Routes><Route path="/" element={<DashboardPage snapshot={snapshot} userId={userId} onPreviewComplete={onPreviewComplete} onPreviewUndo={onPreviewUndo} onPreviewDecision={onPreviewDecision} />} /><Route path="/categories" element={<CategoriesPage snapshot={snapshot} userId={userId} />} /><Route path="/stats" element={<StatsShopPage snapshot={snapshot} userId={userId} onPreviewRequest={onPreviewRequest} onPreviewDecision={onPreviewDecision} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense></AppShell>
}

function AuthenticatedApp({ userId }: { userId: string }) {
  const { data: snapshot, isLoading, error, refetch } = useAppSnapshot(userId)
  useRealtimeRefresh(userId)
  if (isLoading) return <BrandedLoader />
  if (error || !snapshot) return <div className="grid min-h-screen place-items-center bg-app-bg p-5"><div className="w-full max-w-md rounded-[30px] bg-white p-6 shadow-nav"><span className="grid size-12 place-items-center rounded-2xl bg-accent text-white"><Sparkles /></span><h1 className="mt-5 text-2xl font-black">The app is ready for its database.</h1><p className="mt-2 text-sm leading-6 text-ink/55">Apply the included Supabase migrations to the linked project, then create and confirm the two partner accounts.</p><div className="mt-4"><Notice>{(error as Error)?.message || 'Could not load StepByStep data.'}</Notice></div><Button className="mt-4 w-full" onClick={() => void refetch()}>Try again</Button></div></div>
  return <AppContent snapshot={snapshot} userId={userId} />
}

function DemoApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(() => createDemoSnapshot())
  return <AppContent snapshot={snapshot} userId={DEMO_USER_ID} demoMode onPreviewComplete={(habitId) => { const next = previewComplete(snapshot, DEMO_USER_ID, habitId); setSnapshot(next.snapshot); return next.result }} onPreviewUndo={(habitId) => setSnapshot(previewUndoTodayCompletion(snapshot, DEMO_USER_ID, habitId))} onPreviewRequest={(rewardId) => { const next = previewRequestRedemption(snapshot, DEMO_USER_ID, rewardId); setSnapshot(next.snapshot) }} onPreviewDecision={(redemptionId, decision, reason) => setSnapshot(previewDecideRedemption(snapshot, DEMO_USER_ID, redemptionId, decision, reason))} />
}

function AppGate() {
  const { user, loading } = useAuth()
  if (isDemoMode) return <DemoApp />
  if (new URLSearchParams(window.location.search).get('recovery') === '1' || /(?:^|&)type=recovery(?:&|$)/.test(window.location.hash.slice(1))) return <RecoveryPage />
  if (loading) return <BrandedLoader />
  return user ? <AuthenticatedApp userId={user.id} /> : <LoginPage />
}

export function App() {
  return <HashRouter><AuthProvider><AppGate /></AuthProvider></HashRouter>
}
