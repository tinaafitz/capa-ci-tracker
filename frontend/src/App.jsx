import { Routes, Route } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ActivityPage } from '@/pages/ActivityPage'
import { TicketsPage } from '@/pages/TicketsPage'
import { TransactionsPage } from '@/pages/TransactionsPage'
import { PipelinePage } from '@/pages/PipelinePage'
import { LoginPage } from '@/pages/LoginPage'
import { useAuthContext } from '@/store/AppContext'
import { Skeleton } from '@/components/ui/skeleton'

function LoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  )
}

function App() {
  const { user, loading, signIn } = useAuthContext()

  if (loading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <LoginPage onSignIn={signIn} />
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<ActivityPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/:id" element={<TicketsPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
      </Route>
    </Routes>
  )
}

export default App
