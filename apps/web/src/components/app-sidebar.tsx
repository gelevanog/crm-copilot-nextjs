'use client';

import { BarChart3, Building2, Gauge, Handshake, LogOut, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/deals', label: 'Deals', icon: Handshake },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/ai-usage', label: 'AI usage', icon: BarChart3 },
];

export function AppSidebar({ user }: { user: { name: string; email: string; workspace: string } }) {
  const pathname = usePathname();
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2);

  return (
    <aside className="bg-card sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="bg-primary text-ai flex size-7 items-center justify-center rounded-lg">
          <Sparkles className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">CRM Copilot</p>
          <p className="text-muted-foreground text-[11px]">{user.workspace}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                active
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-2.5 rounded-md p-2">
          <span className="bg-muted flex size-8 items-center justify-center rounded-full text-xs font-semibold">
            {initials}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="text-muted-foreground truncate text-[11px]">{user.email}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              title="Sign out"
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1.5"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:hidden">
      {NAV.map(({ href, label }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm',
              active ? 'bg-muted font-medium' : 'text-muted-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
