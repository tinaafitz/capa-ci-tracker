import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { CommandPalette } from '@/components/shared/CommandPalette'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { useAppActions } from '@/store/AppContext'

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { setCommandPaletteOpen } = useAppActions()

  // Auto-collapse sidebar below 1440px
  useEffect(() => {
    function handleResize() {
      setSidebarCollapsed(window.innerWidth < 1440)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between h-14 px-6 border-b border-border bg-background shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">
              CAPA CI Tracker
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Cmd+K search trigger */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-64 justify-start text-muted-foreground font-normal"
              onClick={() => setCommandPaletteOpen(true)}
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Search...</span>
              <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">Cmd</span>K
              </kbd>
            </Button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
      <Toaster position="bottom-right" />
    </div>
  )
}
