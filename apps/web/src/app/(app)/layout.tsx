import type { CurrentUser } from '@crm/shared';
import type { ReactNode } from 'react';
import { AppSidebar, MobileNav } from '@/components/app-sidebar';
import { AskCopilotButton, CopilotProvider } from '@/components/copilot/copilot-provider';
import { ChatDrawer } from '@/components/copilot/chat-drawer';
import { api } from '@/lib/api';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await api<CurrentUser>('/auth/me');

  return (
    <CopilotProvider>
      <div className="flex min-h-screen">
        <AppSidebar user={{ name: me.name, email: me.email, workspace: me.workspace.name }} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/80 sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b px-4 backdrop-blur md:px-8">
            <MobileNav />
            <p className="text-muted-foreground hidden text-sm md:block">
              Signed in to <span className="text-foreground font-medium">{me.workspace.name}</span>
            </p>
            <AskCopilotButton />
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">{children}</main>
        </div>
      </div>
      <ChatDrawer />
    </CopilotProvider>
  );
}
