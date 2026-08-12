import { NavLink } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useAppState, useAuthContext } from '@/store/AppContext'

const navItems = [
  {
    to: '/',
    label: 'Activity',
    shortcut: '1',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    countKey: null,
  },
  {
    to: '/tickets',
    label: 'Tickets',
    shortcut: '2',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
    countKey: 'openTickets',
  },
  {
    to: '/transactions',
    label: 'Builds',
    shortcut: '3',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
    countKey: 'failedBuilds24h',
  },
  {
    to: '/pipeline',
    label: 'Pipeline',
    shortcut: '4',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
      </svg>
    ),
    countKey: 'activeTickets',
  },
]

export function Sidebar({ collapsed, onToggle }) {
  const { counts } = useAppState()
  const { user, signOut } = useAuthContext()

  // Extract user display info from Supabase auth user
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'
  const avatarUrl = user?.user_metadata?.avatar_url || null
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <aside
      className={`flex flex-col border-r border-border bg-sidebar h-full transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-52'
      }`}
    >
      {/* Logo / header area */}
      <div className="flex items-center h-14 px-4 border-b border-border">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-sidebar-foreground hover:text-sidebar-primary transition-colors"
        >
          <svg className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          {!collapsed && (
            <span className="font-semibold text-sm whitespace-nowrap">CAPA CI</span>
          )}
        </button>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 p-2">
        {navItems.map((item) => {
          const count = item.countKey ? counts[item.countKey] : null

          const linkContent = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                } ${collapsed ? 'justify-center px-2' : ''}`
              }
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {count > 0 && (
                    <Badge
                      variant="secondary"
                      className="h-5 min-w-5 px-1.5 text-xs font-medium"
                    >
                      {count}
                    </Badge>
                  )}
                </>
              )}
            </NavLink>
          )

          if (collapsed) {
            return (
              <Tooltip key={item.to} delayDuration={0}>
                <TooltipTrigger render={linkContent} />
                <TooltipContent side="right" className="flex items-center gap-2">
                  {item.label}
                  {count > 0 && (
                    <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-xs">
                      {count}
                    </Badge>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          }

          return linkContent
        })}
      </nav>

      {/* User section */}
      <div className="p-2 border-t border-border">
        {/* Sign out button */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 w-full transition-colors ${
              collapsed ? 'justify-center px-2' : ''
            }`}
            onClick={signOut}
          >
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!collapsed && <span>Sign out</span>}
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">Sign out</TooltipContent>
          )}
        </Tooltip>

        <Separator className="my-1" />

        {/* User avatar and name */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger
            render={
              <div
                className={`flex items-center gap-3 rounded-md px-3 py-2 ${
                  collapsed ? 'justify-center px-2' : ''
                }`}
              />
            }
          >
            <Avatar size="sm">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {displayName}
                </p>
                {user?.email && (
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </p>
                )}
              </div>
            )}
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              <p>{displayName}</p>
              {user?.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  )
}
